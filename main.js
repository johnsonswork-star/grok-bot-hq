import { createChat } from './chat.js';
import * as THREE from './vendor/three.module.js';
import { STATIONS } from './stations.js';
import { createWorkers } from './workers.js';
import { createMonitors } from './monitors.js';
import { startLiveReload, takeResume } from './live.js';

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
warm.position.set(-12, 2.8, 10);
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
const woodFloor = canvasTex(512, 512, (g, w, h) => {
  const rows = 16;
  for (let i = 0; i < rows; i++) {
    let x = -(i % 2) * 128;
    while (x < w) {
      const l = 44 + Math.random() * 12;
      g.fillStyle = `hsl(32, ${24 + Math.random() * 8}%, ${l}%)`;
      g.fillRect(x, i * (h / rows), 256, h / rows);
      for (let s = 0; s < 14; s++) {
        g.strokeStyle = `rgba(60,35,15,${0.05 + Math.random() * 0.08})`;
        g.beginPath(); const yy = i * (h / rows) + Math.random() * (h / rows);
        g.moveTo(x, yy); g.lineTo(x + 256, yy + (Math.random() - 0.5) * 6); g.stroke();
      }
      g.fillStyle = 'rgba(30,18,8,.45)'; g.fillRect(x, i * (h / rows), 2, h / rows);
      x += 256;
    }
    g.fillStyle = 'rgba(30,18,8,.35)'; g.fillRect(0, i * (h / rows), w, 2);
  }
}, [16, 11]);
const M = {
  floor: std('#ffffff', 0.55, 0, { map: woodFloor }),
  carpet: std('#5b6670', 0.95),
  carpetWarm: std('#8a6e58', 0.95),
  wall: std('#efe9e1', 0.9),
  accent: std('#c7764f', 0.85),
  ceiling: std('#f6f3ee', 0.95, 0, { emissive: '#d9d4cc', emissiveIntensity: 0.55 }),
  oak: std('#c9a27a', 0.55),
  walnut: std('#6e4a32', 0.6),
  steel: std('#2c2d31', 0.45, 0.6),
  chair: std('#3a3f47', 0.8),
  chairSeat: std('#4b525c', 0.9),
  bezel: std('#151618', 0.4, 0.3),
  mullion: std('#33363b', 0.5, 0.5),
  glass: new THREE.MeshStandardMaterial({ color: '#cfe6f5', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }),
  light: new THREE.MeshBasicMaterial({ color: '#fffaf0' }),
  pot: std('#d9d3ca', 0.8),
  leaf: std('#4f7d4a', 0.85),
  leaf2: std('#6a9a55', 0.85),
  sofa: std('#a7896d', 0.95),
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
const W = 40, D = 28, H = 3.4, X0 = -20, X1 = 20, Z0 = -14, Z1 = 14;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.ceiling);
ceil.rotation.x = Math.PI / 2; ceil.position.y = H; scene.add(ceil);

// recessed light panels
const panelGeo = new THREE.PlaneGeometry(1.2, 0.6);
for (let x = -16; x <= 16; x += 4) for (let z = -11; z <= 11; z += 4) {
  const p = new THREE.Mesh(panelGeo, M.light); p.rotation.x = Math.PI / 2; p.position.set(x, H - 0.01, z); scene.add(p);
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
// west wall solid with warm accent strip
box(0.2, H, D, M.wall, X0, H / 2, 0, scene, false);
box(0.02, H, 10, M.accent, X0 + 0.11, H / 2, 6, scene, false);
// south wall with glass entry doors at x -1.5..1.5
box(X1 - 1.5, H, 0.2, M.wall, (1.5 + X1) / 2, H / 2, Z1, scene, false);
box(1.5 - X0, H, 0.2, M.wall, (X0 - 1.5) / 2, H / 2, Z1, scene, false);
box(3, H - 2.5, 0.2, M.wall, 0, (2.5 + H) / 2, Z1, scene, false);
box(2.9, 2.5, 0.05, M.glass, 0, 1.25, Z1, scene, false);
box(0.06, 2.5, 0.1, M.mullion, 0, 1.25, Z1, scene, false);
box(0.06, 0.5, 0.06, M.steel, -0.15, 1.1, Z1 - 0.08, scene, false);
box(0.06, 0.5, 0.06, M.steel, 0.15, 1.1, Z1 - 0.08, scene, false);
// room bounds
colliders.push({ minX: -100, maxX: X0 + 0.1, minZ: -100, maxZ: 100 }, { minX: X1 - 0.1, maxX: 100, minZ: -100, maxZ: 100 },
  { minX: -100, maxX: 100, minZ: -100, maxZ: Z0 + 0.1 }, { minX: -100, maxX: 100, minZ: Z1 - 0.1, maxZ: 100 });
// structural columns
for (const [x, z] of [[-8, -8], [8, -8], [-8, 4], [8, 1]]) {
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, H, 20), M.wall);
  col.position.set(x, H / 2, z); col.castShadow = col.receiveShadow = true; scene.add(col);
  addCollider(x, z, 0.6, 0.6);
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
function plant(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.45, 14), M.pot); pot.position.y = 0.225; pot.castShadow = true; g.add(pot);
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), i % 2 ? M.leaf : M.leaf2);
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
function nameplateSprite(st) {
  const tex = canvasTex(1024, 200, (g, w, h) => {
    roundRect(g, 8, 8, w - 16, h - 16, 40); g.fillStyle = 'rgba(24,22,20,.82)'; g.fill();
    g.lineWidth = 6; g.strokeStyle = st.color; g.stroke();
    g.fillStyle = st.color; g.beginPath(); g.arc(80, h / 2, 26, 0, 7); g.fill();
    let fs = 84; g.font = `700 ${fs}px system-ui,Segoe UI,Arial`;
    while (g.measureText(st.name).width > w - 180 && fs > 40) { fs -= 4; g.font = `700 ${fs}px system-ui,Segoe UI,Arial`; }
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(st.name, 130, h / 2 + 4);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const width = st.hero ? 2.2 : 1.5; sp.scale.set(width, width * 200 / 1024, 1); sp.renderOrder = 5;
  sp.userData.baseScale = sp.scale.clone();
  return sp;
}

// ---------- stations ----------
const stations = [];
for (const st of STATIONS) {
  const s = st.hero ? 1.25 : 1;
  const g = new THREE.Group(); g.position.set(st.x, 0, st.z); g.rotation.y = st.ry; scene.add(g);
  const dw = 1.6 * s, dd = 0.8 * s;
  if (st.hero) { // raised round platform + glow ring
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.7, 0.06, 48), std('#3a3530', 0.6)); plat.position.y = 0.03; plat.receiveShadow = true; g.add(plat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: st.color })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.065; g.add(ring);
  }
  box(dw, 0.05, dd, M.oak, 0, 0.74, 0, g);
  box(0.05, 0.72, dd - 0.06, M.steel, -dw / 2 + 0.06, 0.36, 0, g);
  box(0.05, 0.72, dd - 0.06, M.steel, dw / 2 - 0.06, 0.36, 0, g);
  box(dw - 0.2, 0.3, 0.02, M.steel, 0, 0.5, -dd / 2 + 0.06, g);
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
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 12), std(st.color, 0.6)); mug.position.set(-dw / 2 + 0.22, 0.815, 0.05); g.add(mug);
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

// live desk monitors: Grok = HQ chat transcript, others = current task / idle (monitors.js)
const monitors = createMonitors({ stations });
// pod dividers + carpets
for (const cx of [-12.7, 12.7]) {
  box(4.6, 0.5, 0.05, M.divider, cx, 1.02, -5.4);
  const c = box(8, 0.006, 6.2, cx < 0 ? M.carpetWarm : M.carpet, cx, 0.003, -5.4, scene, false); c.castShadow = false;
}
box(15, 0.006, 3.4, M.carpet, 0, 0.003, -11.3, scene, false);

// ---------- conference room (SE) ----------
{
  const cx0 = 8, cz0 = 4;
  // glass wall along z=4 (x 8..20) and x=8 (z 4..14) with door gap at z 8.6..10.2
  box(X1 - cx0, 2.6, 0.04, M.glass, (cx0 + X1) / 2, 1.3, cz0, scene, false);
  box(X1 - cx0, H - 2.6, 0.12, M.wall, (cx0 + X1) / 2, (2.6 + H) / 2, cz0, scene, false);
  box(0.04, 2.6, 8.6 - cz0, M.glass, cx0, 1.3, (cz0 + 8.6) / 2, scene, false);
  box(0.04, 2.6, Z1 - 10.2, M.glass, cx0, 1.3, (10.2 + Z1) / 2, scene, false);
  box(0.12, H - 2.6, Z1 - cz0, M.wall, cx0, (2.6 + H) / 2, (cz0 + Z1) / 2, scene, false);
  for (let x = cx0; x <= X1; x += 2) box(0.05, 2.6, 0.06, M.mullion, x, 1.3, cz0, scene, false);
  for (const z of [cz0, 6.3, 8.6, 10.2, 12.1]) box(0.06, 2.6, 0.05, M.mullion, cx0, 1.3, z, scene, false);
  colliders.push({ minX: cx0, maxX: X1, minZ: cz0 - 0.1, maxZ: cz0 + 0.1 });
  colliders.push({ minX: cx0 - 0.1, maxX: cx0 + 0.1, minZ: cz0, maxZ: 8.6 });
  colliders.push({ minX: cx0 - 0.1, maxX: cx0 + 0.1, minZ: 10.2, maxZ: Z1 });
  // table
  const tx = 14, tz = 9;
  box(5, 0.06, 1.7, M.walnut, tx, 0.75, tz);
  box(0.5, 0.72, 0.5, M.steel, tx - 1.6, 0.36, tz); box(0.5, 0.72, 0.5, M.steel, tx + 1.6, 0.36, tz);
  addCollider(tx, tz, 5, 1.7);
  for (let i = 0; i < 4; i++) { const x = tx - 1.8 + i * 1.2; chair(scene, x, tz - 1.25, Math.PI); chair(scene, x, tz + 1.25, 0); }
  chair(scene, tx - 3, tz, -Math.PI / 2);
  // wall screen on east wall... east wall is glass, so a freestanding display on a stand
  box(0.08, 1.2, 2.1, M.bezel, 18.9, 1.55, tz);
  box(0.12, 0.95, 0.12, M.steel, 18.95, 0.475, tz);
  const brief = canvasTex(1024, 580, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#1d2733'); grd.addColorStop(1, '#3b2a1c'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8a33d'; g.font = '800 92px system-ui,Arial'; g.fillText('HQ BRIEFING', 60, 150);
    g.fillStyle = '#ddd'; g.font = '500 44px system-ui,Arial';
    ['14 bots on the floor', 'Idle bots roam, busy bots sit at their desk', 'Hold View to chat with the team'].forEach((t, i) => g.fillText('• ' + t, 70, 260 + i * 80));
  });
  const bs = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.12), new THREE.MeshBasicMaterial({ map: brief, toneMapped: false }));
  bs.rotation.y = -Math.PI / 2; bs.position.set(18.85, 1.55, tz); scene.add(bs);
  plant(19.2, 4.6, 1.1); plant(9, 13.2, 1);
}

// ---------- reception + logo wall (south, by the door) ----------
{
  // curved-feel reception desk (3 segments) facing the door
  const rx = -3.6, rz = 10.6;
  box(2.6, 1.05, 0.6, M.white, rx, 0.525, rz + 0.6);
  box(0.6, 1.05, 1.6, M.white, rx + 1.6, 0.525, rz);
  box(2.9, 0.04, 0.75, M.oak, rx, 1.07, rz + 0.62);
  box(0.75, 0.04, 1.6, M.oak, rx + 1.6, 1.07, rz);
  addCollider(rx, rz + 0.6, 2.6, 0.6); addCollider(rx + 1.6, rz, 0.6, 1.6);
  chair(scene, rx, rz - 0.3, Math.PI);
  // slatted walnut logo wall behind reception
  const lx = -3.6, lz = 8.3;
  box(5.2, 2.8, 0.12, M.walnut, lx, 1.4, lz);
  for (let i = 0; i < 26; i++) box(0.08, 2.8, 0.05, std('#5b3c28', 0.6), lx - 2.5 + i * 0.2, 1.4, lz + 0.08, scene, false);
  addCollider(lx, lz, 5.2, 0.15);
  const logo = canvasTex(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#f4e6cf'; g.font = '800 120px system-ui,Segoe UI,Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('GROK BOT HQ', w / 2, h / 2 - 10); g.fillStyle = '#e8a33d'; g.fillRect(w / 2 - 160, h - 40, 320, 8);
  });
  const lm = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: logo, transparent: true, toneMapped: false }));
  lm.position.set(lx, 1.85, lz + 0.12); scene.add(lm);
  plant(-0.9, 12.8, 1.2); plant(1.9, 12.8, 1.2); plant(-6.6, 8.6, 1);
}

// ---------- lounge (SW) ----------
{
  const rug = box(6, 0.008, 4.2, M.carpetWarm, -13, 0.004, 10.5, scene, false); rug.castShadow = false;
  // L sofa
  box(4, 0.42, 0.9, M.sofa, -13, 0.21, 12.7); box(4, 0.5, 0.25, M.sofa, -13, 0.67, 13.05);
  box(0.9, 0.42, 2.4, M.sofa, -15.6, 0.21, 11.1); box(0.25, 0.5, 2.4, M.sofa, -15.95, 0.67, 11.1);
  addCollider(-13, 12.8, 4, 1.1); addCollider(-15.7, 11.1, 1.1, 2.4);
  box(1.6, 0.05, 0.8, M.walnut, -12.8, 0.42, 10.8); box(1.4, 0.38, 0.6, M.steel, -12.8, 0.19, 10.8);
  addCollider(-12.8, 10.8, 1.6, 0.8);
  // kitchenette along west wall: cabinets with doors, sink, coffee machine, stainless fridge (reads as a kitchen, not a counter)
  {
    const kx = -19.55, kz = 8.5, cab = std('#e9e6e0', 0.6), seam = std('#9a948b', 0.8), handle = std('#b8bcc2', 0.3, 0.8);
    box(0.65, 0.86, 4, cab, kx, 0.45, kz); box(0.7, 0.04, 4.05, M.walnut, kx, 0.9, kz);
    box(0.08, 0.1, 4, std('#3a3a3a', 0.9), kx + 0.3, 0.05, kz, scene, false); // toe kick
    for (let i = 0; i < 5; i++) { const z = kz - 2 + 0.4 + i * 0.8;
      box(0.012, 0.74, 0.012, seam, kx + 0.33, 0.48, z + 0.4, scene, false);
      box(0.02, 0.14, 0.025, handle, kx + 0.345, 0.72, z + 0.3, scene, false); }
    // sink + faucet
    box(0.42, 0.02, 0.6, std('#c9ccd0', 0.25, 0.8), kx + 0.02, 0.925, kz + 0.9, scene, false);
    box(0.04, 0.3, 0.04, handle, kx - 0.22, 1.07, kz + 0.9, scene, false); box(0.18, 0.04, 0.04, handle, kx - 0.14, 1.21, kz + 0.9, scene, false);
    // coffee machine + mugs
    box(0.32, 0.42, 0.3, std('#1d1d1f', 0.4, 0.3), kx - 0.05, 1.13, kz - 0.9);
    box(0.02, 0.1, 0.16, std('#e8a33d', 0.5), kx + 0.115, 1.2, kz - 0.9, scene, false);
    for (const [dz, c] of [[-0.35, '#c7764f'], [-0.2, '#4a7fb5']]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 12), std(c, 0.6)); m.position.set(kx + 0.1, 0.97, kz + dz); scene.add(m); }
    // upper cabinets with doors
    box(0.4, 0.8, 4, cab, -19.7, 2.1, kz);
    for (let i = 0; i < 5; i++) { const z = kz - 2 + i * 0.8;
      if (i) box(0.012, 0.76, 0.012, seam, -19.49, 2.1, z, scene, false);
      box(0.02, 0.12, 0.025, handle, -19.48, 1.82, z + 0.65, scene, false); }
    // stainless fridge with door split + handles
    const fx = -19.5, fz = 5.9, ss = std('#c3c7cc', 0.35, 0.7);
    box(0.75, 1.95, 0.85, ss, fx, 0.975, fz);
    box(0.012, 1.95, 0.012, seam, fx + 0.38, 0.975, fz, scene, false);
    box(0.04, 0.9, 0.04, std('#6b6f75', 0.3, 0.8), fx + 0.4, 1.15, fz - 0.07, scene, false);
    box(0.04, 0.9, 0.04, std('#6b6f75', 0.3, 0.8), fx + 0.4, 1.15, fz + 0.07, scene, false);
    addCollider(-19.55, 7.9, 0.75, 5.2);
  }
  plant(-19, 13, 1.3); plant(-10.2, 13.2, 1);
}

// extra greenery near windows and pods
// water cooler on the west wall between the plants, near the window corner (where Chris asked for it; workers stop here when idle)
// classic office cooler: white cabinet, big blue jug upside-down on top, blue/red taps, drip tray, paper-cup tube + bin
const COOLER = { x: -19.45, z: -5.2 };
function waterCooler(x, z, ry = Math.PI / 2) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; // local +z = front (faces into the room)
  const white = std('#f4f5f7', 0.45), grey = std('#9aa0a6', 0.5), dark = std('#2b2f33', 0.6);
  const jugMat = new THREE.MeshPhysicalMaterial({ color: '#3d9bff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, clearcoat: 1 });
  // cabinet
  box(0.36, 0.98, 0.34, white, 0, 0.49, 0, g);
  box(0.37, 0.05, 0.35, grey, 0, 0.025, 0, g);                       // base
  box(0.38, 0.03, 0.36, white, 0, 1.0, 0, g);                         // top lip
  box(0.26, 0.26, 0.02, dark, 0, 0.78, 0.171, g, false);              // recessed tap panel
  box(0.24, 0.02, 0.08, grey, 0, 0.66, 0.2, g, false);                // drip tray
  box(0.05, 0.06, 0.06, std('#1e6fe0', 0.4), -0.06, 0.84, 0.2, g, false); // cold tap
  box(0.05, 0.06, 0.06, std('#d8312b', 0.4), 0.06, 0.84, 0.2, g, false);  // hot tap
  box(0.2, 0.004, 0.004, grey, 0, 0.42, 0.171, g, false);             // door seam
  // jug: upside-down 5-gallon bottle with shoulders, ribs and a neck into the cabinet
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.34, 28), jugMat); jug.position.y = 1.33; g.add(jug);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.15, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), jugMat); top.position.y = 1.5; g.add(top);
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.055, 0.1, 28), jugMat); shoulder.position.y = 1.11; g.add(shoulder);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 16), jugMat); neck.position.y = 1.04; g.add(neck);
  for (const y of [1.24, 1.42]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.008, 6, 28), jugMat); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); }
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.153, 0.153, 0.07, 28, 1, true, -0.9, 1.8), std('#ffffff', 0.6)); label.position.y = 1.33; g.add(label);
  // paper-cup dispenser tube on the side, with a cup sticking out the bottom
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.36, 14), new THREE.MeshPhysicalMaterial({ color: '#dfe7ee', transparent: true, opacity: 0.55, roughness: 0.1 }));
  tube.position.set(0.23, 0.72, 0.05); g.add(tube);
  box(0.06, 0.03, 0.04, grey, 0.2, 0.72, 0.05, g, false);
  const cupMat = std('#ffffff', 0.7);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.07, 14), cupMat); cup.position.set(0.23, 0.505, 0.05); g.add(cup);
  // couple of cups on the drip tray + a small bin
  for (const dx of [-0.05, 0.07]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.065, 12), cupMat); c.position.set(dx, 0.705, 0.2); g.add(c); }
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.36, 18), grey); bin.position.set(-0.36, 0.18, 0.02); bin.castShadow = true; g.add(bin);
  // little "WATER" sign above it so it reads from across the room
  const sign = canvasTex(256, 96, (c, w, h) => { roundRect(c, 4, 4, w - 8, h - 8, 18); c.fillStyle = '#1e6fe0'; c.fill(); c.fillStyle = '#fff'; c.font = '800 44px system-ui,Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('💧 WATER', w / 2, h / 2 + 2); });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), new THREE.MeshBasicMaterial({ map: sign, transparent: true, toneMapped: false }));
  sm.position.set(0, 2.0, -0.24); g.add(sm);
  scene.add(g); addCollider(x, z, 1.0, 0.6, ry);
}
waterCooler(COOLER.x, COOLER.z);
for (const [x, z, s] of [[-19, -13, 1.4], [19, -13, 1.4], [-9.5, -12.8, 1], [9.5, -12.8, 1], [-17.5, -8.5, 1.1], [17.5, -8.5, 1.1], [-3, 2.8, 0.9], [3, 2.8, 0.9], [19, 0, 1.2], [-19, -2, 1.1]]) plant(x, z, s);

// (created after every prop so their nav grid knows about plants, lounge, kitchen, cooler, conference room)
// worker characters (one per bot): wander when idle, sit + type at their desk when busy (tasks.json)
const workers = createWorkers({ scene, stations, colliders,
  extraColliders: [-12.7, 12.7].map(cx => ({ minX: cx - 2.3, maxX: cx + 2.3, minZ: -5.45, maxZ: -5.35 })), onStatus: (s, busy, task, meta = {}) => {
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
renderer.domElement.addEventListener('click', () => { if (!paused && !document.pointerLockElement) lockPointer(); });
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
canvasEl.addEventListener('touchstart', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
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
    } else if (touch.look && t.identifier === touch.look.id) {
      touch.ldx += t.clientX - touch.look.x; touch.ldy += t.clientY - touch.look.y;
      touch.look.x = t.clientX; touch.look.y = t.clientY;
    }
  }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
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
    <small>Hold View (or Enter) to message this bot via Grok Bot + team. B / Q / A to close.</small>`;
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
  const area = Math.hypot(x - COOLER.x, z - COOLER.z) < 3 ? 'by the water cooler' : x < -9 && z > 6 ? 'lounge / kitchen' : x > 8 && z > 4 ? 'conference room'
    : z > 6 ? 'reception / entrance' : z < -10 ? 'north window side' : x < -9 ? 'west side' : x > 9 ? 'east side' : 'middle of the floor';
  return { x, z, heading, facing, area, near: near && near.d < 4 ? near : null };
}
function stampWhere(g, w, h) {
  const p = whereAmI(), k = Math.max(0.6, w / 1280);
  const line1 = `📍 Chris at x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)} · facing ${p.facing} (${Math.round(p.heading)}°)`;
  const line2 = `${p.area}${p.near ? ` · near ${p.near.s.name}'s desk (${p.near.d.toFixed(1)} m)` : ''} · north = window wall`;
  g.font = `600 ${Math.round(22 * k)}px system-ui,Arial`;
  const bw = Math.max(g.measureText(line1).width, g.measureText(line2).width) + 28 * k, bh = 66 * k;
  g.fillStyle = 'rgba(0,0,0,.62)'; roundRect(g, 10 * k, 10 * k, bw, bh, 10 * k); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(line1, 24 * k, 18 * k);
  g.fillStyle = '#ffd59a'; g.font = `500 ${Math.round(19 * k)}px system-ui,Arial`; g.fillText(line2, 24 * k, 44 * k);
  // mini floor map (top-down, north up): room 40 x 28, desks, cooler, Chris + view cone
  const mw = 220 * k, mh = mw * D / W, mx = w - mw - 12 * k, my = 30 * k, sx = mw / W, sz = mh / D;
  const P = (x, z) => [mx + (x - X0) * sx, my + (z - Z0) * sz];
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(mx - 6 * k, my - 6 * k, mw + 12 * k, mh + 12 * k);
  g.fillStyle = '#d9c6a8'; g.fillRect(mx, my, mw, mh);
  g.fillStyle = '#7fc4ff'; g.fillRect(mx, my, mw, 3 * k); g.fillRect(mx + mw - 3 * k, my, 3 * k, mh); // windows N + E
  g.fillStyle = '#c7764f'; g.fillRect(mx, my + (1 - Z0) * sz, 3 * k, 10 * sz);                     // west accent wall
  g.strokeStyle = 'rgba(80,110,140,.8)'; g.lineWidth = 1.5 * k; g.strokeRect(...P(8, 4), (X1 - 8) * sx, (Z1 - 4) * sz); // conference
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
  setFocus(paused ? null : findFocus());
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
  if (!resume.paused) setPaused(false);
  if (resume.chat) { chat.show(stations.find(s => s.id === resume.chat.to) || stations.find(s => s.hero)); chat.restoreDraft(resume.chat); }
  else if (resume.draft?.text) chat.restoreDraft(resume.draft);
  setTimeout(() => toast('Office updated'), 300);
}
function toast(msg) {
  let el = document.getElementById('livetoast');
  if (!el) { el = document.createElement('div'); el.id = 'livetoast'; el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);background:rgba(24,22,20,.88);color:#ffd59a;padding:8px 16px;border-radius:999px;font:600 14px system-ui,Arial;z-index:50;pointer-events:none;transition:opacity .4s'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}
startLiveReload({
  toast,
  isSafe: () => !chat.isSending() && !chat.isTyping(),
  getState: () => ({ x: player.pos.x, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, paused,
    chat: chat.isOpen() ? chat.draft() : null, draft: chat.draft() }),
});
tick();
// debug hook for automated screenshots
window.__office = { player, stations, setPaused, nextStation, IS_IOS, CAN_LOCK, chat, openChat, snapshot, workers, monitors };

// ---------- PWA: offline-capable once loaded (network-first, so updates show up right away) ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
