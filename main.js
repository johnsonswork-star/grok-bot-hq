import { createChat } from './chat.js';
import { createSuggestBox } from './suggest.js';
import * as THREE from './vendor/three.module.js';
import { STATIONS } from './stations.js';
import { createWorkers } from './workers.js';
import { buildCharacter } from './characters.js';
import { createMonitors } from './monitors.js';
import { createTalk } from './talk.js';
import { createWhiteboard } from './whiteboard.js';
import { startLiveReload, takeResume } from './live.js';
import { fetchInboxFeed, fetchBankFeed, fetchWorkFeed, fetchChatFeed, requestRefresh, requestPick, fetchSwipeDeck, swipeStatus, sendSwipes, sendSuggest } from './hq-link.js';
import { createSwipeWall } from './swipe.js';
import { createWarehouseWork } from './warehouse-work.js';

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

// HQ #102: quality tier early so renderer + textures can go HD on iPad. ?q=low|med|high|hd or localStorage hqQuality.
const QUALITY_RAW = (new URLSearchParams(location.search).get('q') || localStorage.getItem('hqQuality') || 'high').toLowerCase();
const QUALITY = QUALITY_RAW === 'hd' ? 'high' : QUALITY_RAW; // hd == high
window.hqSetQuality = q => { localStorage.setItem('hqQuality', q); location.reload(); };
const HQ_HD = QUALITY === 'high';
const HQ_LOW = QUALITY === 'low';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// HD: use more of the iPad's retina pixels (was capped at 1.25 — looked soft). low keeps 1x.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, HQ_LOW ? 1 : (HQ_HD ? (IS_MOBILE ? 2 : 2.5) : (IS_MOBILE ? 1.5 : 1.75))));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = HQ_LOW || (!HQ_HD && IS_MOBILE) ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
// HQ #101: gradient sky dome (replaces flat Color) — cheap, iPad-safe
scene.background = new THREE.Color('#6aa3d4');
scene.fog = new THREE.Fog('#b8cfe0', 70, 200);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 250);
camera.rotation.order = 'YXZ';
const EYE = 1.65;

// ---------- lights ----------
// HQ #101: warmer interior ambient, softer sun, stronger window spill
scene.add(new THREE.HemisphereLight('#fff4e4', '#7a6a58', 0.95));
const sun = new THREE.DirectionalLight('#ffe8c8', 1.35);
sun.position.set(8, 22, -10);
sun.castShadow = true;
sun.shadow.mapSize.set(HQ_LOW ? 512 : (HQ_HD ? (IS_MOBILE ? 2048 : 4096) : (IS_MOBILE ? 1024 : 2048)), HQ_LOW ? 512 : (HQ_HD ? (IS_MOBILE ? 2048 : 4096) : (IS_MOBILE ? 1024 : 2048)));
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 14, bottom: -14, near: 1, far: 55 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
scene.add(sun);
// Daylight spill from north windows (cooler, brighter — reads as sky)
const winFill = new THREE.DirectionalLight('#e8f2ff', 0.85);
winFill.position.set(2, 8, -28);
scene.add(winFill);
const winFill2 = new THREE.DirectionalLight('#fff0d8', 0.35);
winFill2.position.set(-12, 5, -20);
scene.add(winFill2);
const warm = new THREE.PointLight('#ffc988', 5.5, 14, 2);
warm.position.set(0, 2.6, 4.2); // warm spill over Pam's reception
scene.add(warm);
// soft ceiling bounce over the bullpen (fake GI)
const bounce = new THREE.PointLight('#fff2e0', 3.2, 16, 2);
bounce.position.set(0, 2.9, -1);
scene.add(bounce);

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
// HQ #101b: cheap baked AO / contact-shadow blob (shared tex+mat; one draw when instanced)
const _csTex = (() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(20,14,10,0.55)'); grd.addColorStop(0.45, 'rgba(20,14,10,0.22)');
  grd.addColorStop(0.8, 'rgba(20,14,10,0.06)'); grd.addColorStop(1, 'rgba(20,14,10,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
})();
const CS_MAT = new THREE.MeshBasicMaterial({ map: _csTex, transparent: true, opacity: 1, depthWrite: false, fog: false });
const CS_GEO = new THREE.PlaneGeometry(1, 1);
const _csStatic = []; // {x,z,sx,sz} collected then built as one InstancedMesh
function contactBlob(x, z, sx = 0.7, sz = 0.55, opacity = 0.32) {
  _csStatic.push({ x, z, sx, sz, opacity });
}
function contactBlobLocal(parent, x, z, sx = 0.55, sz = 0.45, opacity = 0.28) {
  const m = new THREE.Mesh(CS_GEO, CS_MAT);
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.011, z); m.scale.set(sx, sz, 1);
  m.renderOrder = 1; m.material = CS_MAT; // shared
  // per-mesh opacity via material clone would explode draws — bake into scale darkness instead
  parent.add(m); return m;
}
function flushContactShadows() {
  if (!_csStatic.length) return;
  const mesh = new THREE.InstancedMesh(CS_GEO, CS_MAT, _csStatic.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  _csStatic.forEach((c, i) => { p.set(c.x, 0.011, c.z); s.set(c.sx, c.sz, 1); m4.compose(p, q, s); mesh.setMatrixAt(i, m4); });
  mesh.renderOrder = 1; mesh.frustumCulled = true; scene.add(mesh);
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = HQ_LOW ? 2 : (HQ_HD ? (IS_MOBILE ? 8 : 16) : (IS_MOBILE ? 4 : 8));
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const std = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const shadeHex = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

// ---------- materials ----------
// commercial carpet tiles (the Dunder Mifflin floor): blue-grey, speckled, quarter-turned tiles
// HQ #101: higher-contrast commercial carpet tiles (quarter-turned loop pile)
// HQ #101b: commercial carpet tiles with real grout channels + per-tile AO + less uniform color
const carpetTex = canvasTex(512, 512, (g, w, h) => {
  const n = 4, t = w / n, grout = 5;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const hue = 210 + ((i * 5 + j * 3) % 9) - 4;
    const sat = 10 + ((i + j * 2) % 5);
    const l = 30 + ((i * 7 + j * 11) % 13) + Math.random() * 5;
    g.fillStyle = `hsl(${hue}, ${sat}%, ${l}%)`; g.fillRect(i * t, j * t, t, t);
    // soft AO toward tile edges (reads as recessed grout wells)
    const grd = g.createRadialGradient(i * t + t / 2, j * t + t / 2, t * 0.15, i * t + t / 2, j * t + t / 2, t * 0.72);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.04)'); grd.addColorStop(1, 'rgba(8,10,16,0.28)');
    g.fillStyle = grd; g.fillRect(i * t, j * t, t, t);
    const vert = (i + j) % 2;
    for (let k = 0; k < 420; k++) {
      g.fillStyle = `rgba(${Math.random() < .5 ? '14,18,28' : '200,210,225'},${0.08 + Math.random() * 0.18})`;
      const x = i * t + grout + Math.random() * (t - grout * 2), y = j * t + grout + Math.random() * (t - grout * 2);
      vert ? g.fillRect(x, y, 1.2, 6 + Math.random() * 4) : g.fillRect(x, y, 6 + Math.random() * 4, 1.2);
    }
    // recessed grout (dark channel + soft highlight on one side)
    g.fillStyle = 'rgba(10,12,18,.55)'; g.fillRect(i * t, j * t, t, grout); g.fillRect(i * t, j * t, grout, t);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(i * t + grout, j * t + grout, t - grout, 1.5);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(i * t + t - 2, j * t + grout, 2, t - grout);
  }
}, [10, 7]);
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
  chair: std('#2e333a', 0.88),
  chairSeat: std('#3a424c', 0.92),
  bezel: std('#151618', 0.4, 0.3),
  mullion: std('#2a2d32', 0.45, 0.55),
  glass: new THREE.MeshStandardMaterial({ color: '#cfe6f5', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, emissive: '#8ab4d8', emissiveIntensity: 0.12 }),
  light: new THREE.MeshBasicMaterial({ color: '#fffaf0' }),
  pot: std('#d9d3ca', 0.8),
  leaf: std('#3d6b38', 0.82),
  leaf2: std('#5a8a48', 0.8),
  leaf3: std('#2f5530', 0.85),
  sofa: std('#5c4a3d', 0.95),
  white: std('#f2f2f0', 0.6),
  divider: std('#b9b2a7', 0.95),
  ground: std('#7a9a55', 1),
  paving: std('#c9c4bb', 0.95),
  bldg: std('#d6dde4', 0.9),
  bldgBrick: std('#c4a088', 0.88),
  bldgDark: std('#6a7380', 0.85),
  concrete: std('#c8c4bc', 0.92),
};


// ---------- HQ #90: visual upgrade (procedural PBR + cheap env lighting; iPad-safe) ----------
// QUALITY / HQ_HD / HQ_LOW set near top (HQ #102). Low skips extra maps on big surfaces.
if (HQ_LOW) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1)); renderer.shadowMap.type = THREE.PCFShadowMap; }

renderer.toneMappingExposure = 1.08; // HQ #101: slightly brighter so wood + facade textures read
// image-based light from a tiny procedural "office room" (bright ceiling panels, warm floor, window wall), prefiltered once
{
  const envScene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 20), new THREE.MeshBasicMaterial({ color: '#6d6a64', side: THREE.BackSide }));
  envScene.add(room);
  const panel = (w, d, x, y, z, c, ry = 0, rx = Math.PI / 2) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); envScene.add(m); };
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) panel(3, 1.4, i * 6, 2.9, j * 6, '#fff6e6');
  panel(18, 3, 0, 1.5, -9.9, '#bcd8ef', 0, 0);          // window wall: soft sky
  panel(20, 20, 0, -2.9, 0, '#5d636b');                  // carpet bounce
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(envScene, 0.04).texture; pm.dispose();
  scene.environment = env;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.7; // HQ #101: stronger desk/glass reflections
}
// hemi/fill slightly lower since the env map now carries ambient
scene.traverse(o => { if (o.isHemisphereLight) o.intensity = 0.8; });
sun.shadow.radius = 4; sun.shadow.blurSamples = 12;
// helper: grayscale canvas texture (roughness/bump), linear colour space
function dataTex(w, h, draw, repeat) { const t = canvasTex(w, h, draw, repeat); t.colorSpace = THREE.NoColorSpace; return t; }
const rnd = Math.random;
// carpet bump: dense loop pile noise
if (QUALITY !== 'low') {
  const carpetBump = dataTex(256, 256, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    // loop pile
    for (let k = 0; k < 10000; k++) { const v = 85 + rnd() * 95 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * w, rnd() * h, 1.2, 1.2); }
    // grout channels (dark = recessed) matching 4x4 tile layout
    g.fillStyle = '#2a2a2a'; const t = w / 4;
    for (let i = 0; i <= 4; i++) { g.fillRect(i * t - 2, 0, 4, h); g.fillRect(0, i * t - 2, w, 4); }
  }, [40, 28]);
  M.floor.bumpMap = carpetBump; M.floor.bumpScale = 1.35;
  const carpetR = dataTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2000; k++) { const v = 140 + rnd() * 80 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    g.fillStyle = '#404040'; const t = w / 4;
    for (let i = 0; i <= 4; i++) { g.fillRect(i * t - 2, 0, 4, h); g.fillRect(0, i * t - 2, w, 4); }
  }, [40, 28]);
  M.floor.roughnessMap = carpetR; M.floor.roughness = 0.92;
  for (const k of ['carpet', 'carpetWarm', 'rug']) { M[k].bumpMap = carpetBump; M[k].bumpScale = 1.2; M[k].roughnessMap = carpetR; }
}
// wall: eggshell paint with faint orange-peel roller texture
const wallTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#ece4d4'; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(${rnd() < .5 ? '255,255,255' : '120,100,80'},0.05)`; const r = 1 + rnd() * 3; g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, 7); g.fill(); } }, [6, 2]);
M.wall.map = wallTex; M.wall.color.set('#f0e8da'); M.wall.roughness = 0.94; M.wall.envMapIntensity = 0.18;
if (QUALITY !== 'low') { M.wall.bumpMap = wallTex; M.wall.bumpScale = 0.28; }
// ceiling: 2x4 acoustic drop tiles with T-bar grid + fissured speckle
const ceilTex = canvasTex(256, 512, (g, w, h) => { g.fillStyle = '#f3f0ea'; g.fillRect(0, 0, w, h);
  for (let k = 0; k < 3000; k++) { g.fillStyle = `rgba(110,100,90,${0.05 + rnd() * 0.15})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); }
  g.fillStyle = '#e2ddd4'; g.fillRect(0, 0, w, 6); g.fillRect(0, 0, 6, h); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(6, 6, w, 2); g.fillRect(6, 6, 2, h); });
ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping; ceilTex.repeat.set(36, 12);
M.ceiling.map = ceilTex; M.ceiling.emissiveMap = ceilTex; M.ceiling.emissiveIntensity = 0.45;
// wood: desk laminate grain for oak / walnut / pallets / reception
function woodTex(base, dark, rep) { return canvasTex(512, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 1) { const a = 0.04 + 0.08 * Math.abs(Math.sin(y * 0.11 + Math.sin(y * 0.03) * 3)); g.fillStyle = `rgba(${dark},${a})`; g.fillRect(0, y, w, 1); }
  for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(${dark},0.12)`; g.beginPath(); const y = rnd() * h; g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 4); g.stroke(); } }, rep); }
const oakT = woodTex('#ffffff', '120,80,40', [1, 1]), walT = woodTex('#ffffff', '50,25,10', [1, 1]);
M.oak.map = oakT; M.oak.roughness = 0.5; M.walnut.map = walT; M.walnut.roughness = 0.5; M.recep.map = oakT; M.pallet.map = woodTex('#ffffff', '80,50,20', [1, 1]);
// brushed metal on steel/cabinets/mullions picks up the env map; glass gets a real reflection
for (const k of ['steel', 'cabinet', 'mullion', 'copierDark']) { M[k].envMapIntensity = 1.2; }
for (const k of ['glass', 'vendGlass', 'glassJar']) { M[k].envMapIntensity = 1.6; M[k].roughness = 0.03; }
M.chair.roughness = 0.88; M.chairSeat.roughness = 0.94;
// HQ #101: fabric weave on chairs, concrete/paint on columns, grass + facade maps, sky dome
{
  const fabric = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#3a424c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      g.fillStyle = (x + y) % 4 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.07)';
      g.fillRect(x, y, 2, 2);
    }
    for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${rnd() < .5 ? '200,210,220' : '20,24,30'},0.06)`; g.fillRect(rnd() * w, rnd() * h, 1, 1); }
  }, [3, 3]);
  M.chair.map = fabric; M.chair.color.set('#ffffff'); M.chairSeat.map = fabric; M.chairSeat.color.set('#c8cdd4');
  // concrete / painted structural column
  // HQ #101b: matte painted concrete (dirt band, high roughness, low env — not plastic)
  const conc = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#e4ddd0'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 5000; k++) { const v = 200 + rnd() * 40 | 0; g.fillStyle = `rgba(${v},${v - 8},${v - 16},0.35)`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1); }
    g.fillStyle = 'rgba(120,100,80,0.08)'; for (let y = 0; y < h; y += 48) g.fillRect(0, y, w, 2);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 14, h);
    g.fillStyle = 'rgba(90,70,50,0.16)'; g.fillRect(0, h * 0.78, w, h * 0.22);
    g.fillStyle = 'rgba(0,0,0,0.07)'; for (let k = 0; k < 50; k++) g.fillRect(rnd() * w, h * 0.7 + rnd() * h * 0.28, 6 + rnd() * 28, 1.5);
  }, [1, 2]);
  M.concrete.map = conc; M.concrete.roughness = 0.96; M.concrete.envMapIntensity = 0.12;
  M.concrete.bumpMap = conc; M.concrete.bumpScale = 0.55; M.concrete.color.set('#ebe4d6');
  // grass with subtle variation
  const grassT = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f9450'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 8000; k++) {
      const v = 80 + rnd() * 70 | 0; g.fillStyle = `rgb(${v * 0.55 | 0},${v},${v * 0.4 | 0})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd());
    }
  }, [80, 80]);
  M.ground.map = grassT; M.ground.color.set('#ffffff'); M.ground.roughness = 1;
  // office-building facade: rows of windows (some lit)
  function facadeTex(base, accent, litChance = 0.35) {
    return canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      // subtle panel lines
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
      for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      const rows = 14, cols = 6, mw = 18, mh = 22, gapX = (w - cols * mw) / (cols + 1), gapY = (h - rows * mh) / (rows + 1);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = gapX + c * (mw + gapX), y = gapY + r * (mh + gapY);
        const lit = rnd() < litChance;
        g.fillStyle = lit ? accent : 'rgba(30,40,55,0.85)';
        g.fillRect(x, y, mw, mh);
        if (lit) { g.fillStyle = 'rgba(255,240,180,0.35)'; g.fillRect(x + 1, y + 1, mw - 2, mh * 0.35); }
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.strokeRect(x, y, mw, mh);
      }
      // roof coping
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 0, w, 8);
    }, [1, 1]);
  }
  const facA = facadeTex('#c8d0d8', '#ffe9a8', 0.4);
  const facB = facadeTex('#a88870', '#ffd89a', 0.25);
  const facC = facadeTex('#5a6570', '#9ec8ff', 0.5);
  M.bldg.map = facA; M.bldg.color.set('#ffffff'); M.bldg.roughness = 0.82; M.bldg.envMapIntensity = 0.4;
  M.bldgBrick.map = facB; M.bldgBrick.color.set('#ffffff'); M.bldgBrick.roughness = 0.88;
  M.bldgDark.map = facC; M.bldgDark.color.set('#ffffff'); M.bldgDark.roughness = 0.75; M.bldgDark.envMapIntensity = 0.5;
  // foliage variation via canvas noise (shared)
  const leafT = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#3d6b38'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(${40 + rnd() * 80 | 0},${90 + rnd() * 100 | 0},${30 + rnd() * 40 | 0},0.55)`;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 6, 0, 7); g.fill();
    }
  }, [2, 2]);
  for (const k of ['leaf', 'leaf2', 'leaf3']) { M[k].map = leafT; M[k].color.set(k === 'leaf2' ? '#c8e0a8' : k === 'leaf3' ? '#8aaa70' : '#a8c888'); M[k].roughness = 0.9; }
  // wood roughness streak map
  if (QUALITY !== 'low') {
    const woodR = dataTex(256, 128, (g, w, h) => {
      g.fillStyle = '#909090'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y++) { const a = 0.35 + 0.3 * Math.sin(y * 0.2); g.fillStyle = `rgb(${(a * 255) | 0},${(a * 255) | 0},${(a * 255) | 0})`; g.fillRect(0, y, w, 1); }
    }, [1, 1]);
    M.oak.roughnessMap = woodR; M.walnut.roughnessMap = woodR; M.oak.roughness = 0.45; M.walnut.roughness = 0.5;
  }
  // warmer oak / richer walnut base so grain reads through the window light
  M.oak.color.set('#d4a574'); M.walnut.color.set('#7a5236');
  M.oak.envMapIntensity = 0.35; M.walnut.envMapIntensity = 0.3;
}
for (const k in M) if (M[k].isMaterial) M[k].needsUpdate = true;

// HQ #101: sky dome (gradient + soft horizon haze). One draw call; fog:false so it stays vivid.
{
  const skyC = document.createElement('canvas'); skyC.width = 8; skyC.height = 512;
  const sg = skyC.getContext('2d');
  const grd = sg.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0.00, '#1a3a72'); // zenith
  grd.addColorStop(0.28, '#3d7ec4');
  grd.addColorStop(0.48, '#7eb6e8');
  grd.addColorStop(0.62, '#b7d6f0');
  grd.addColorStop(0.74, '#dce8f2');
  grd.addColorStop(0.84, '#e8d4b0'); // warm horizon
  grd.addColorStop(0.92, '#c8d4a8');
  grd.addColorStop(1.00, '#9aaa78');
  sg.fillStyle = grd; sg.fillRect(0, 0, 8, 512);
  // soft cloud wisps (very cheap)
  sg.globalAlpha = 0.18; sg.fillStyle = '#ffffff';
  for (let i = 0; i < 14; i++) { const y = 160 + Math.random() * 160; sg.beginPath(); sg.ellipse(4, y, 6, 4 + Math.random() * 8, 0, 0, 7); sg.fill(); }
  sg.globalAlpha = 1;
  const skyTex = new THREE.CanvasTexture(skyC); skyTex.colorSpace = THREE.SRGBColorSpace; skyTex.wrapS = THREE.RepeatWrapping; skyTex.wrapT = THREE.ClampToEdgeWrapping;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);
}

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
const LAYOUT = 'scranton-10-wh-stairs'; // bump when the floor plan changes: live reload then drops Chris at the front door instead of inside a new wall
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
// west wall (water cooler on it). HQ #73 doorway, HQ #79 stairs; HQ #83: the door is now a steel door just north of the
// cooler (z -4.25..-3.05) that opens onto the top landing of the warehouse's corner metal stairs (show-accurate)
const WH_DOOR = [-4.25, -3.05];
box(0.2, H, WH_DOOR[0] - Z0, M.wall, X0, H / 2, (Z0 + WH_DOOR[0]) / 2, scene, false);
box(0.2, H, Z1 - WH_DOOR[1], M.wall, X0, H / 2, (WH_DOOR[1] + Z1) / 2, scene, false);
box(0.2, H - 2.4, WH_DOOR[1] - WH_DOOR[0], M.wall, X0, (2.4 + H) / 2, (WH_DOOR[0] + WH_DOOR[1]) / 2, scene, false);
// south wall with the front entrance at x -0.8..0.8
box(X1 - 0.8, H, 0.2, M.wall, (0.8 + X1) / 2, H / 2, Z1, scene, false);
box(-0.8 - X0, H, 0.2, M.wall, (X0 - 0.8) / 2, H / 2, Z1, scene, false); // HQ #76 fix: this used to run to x 0 and wall off half the doorway
box(1.6, H - 2.4, 0.2, M.wall, 0, (2.4 + H) / 2, Z1, scene, false);
// ---------- front entrance: real double glass doors (HQ #76) ----------
// Two hinged storefront leaves (dark aluminum stiles + rails, glass, kick plate, push bar inside / pull handle outside,
// DUNDER MIFFLIN vinyl on the glass). They swing OUT onto the sidewalk when you walk up (either side) and close behind you.
// While closed a collider fills the doorway; it drops out once they're open.
const FRONT_DOOR = { open: 0, target: 0, leaves: [], col: { minX: -0.8, maxX: 0.8, minZ: Z1 - 0.12, maxZ: Z1 + 0.12 } };
{
  const alu = std('#2b2e33', 0.35, 0.7), kick = std('#9aa0a6', 0.3, 0.85), handleM = std('#c9cdd2', 0.25, 0.9);
  const doorGlass = new THREE.MeshStandardMaterial({ color: '#bcd7e6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false });
  const vinyl = canvasTex(256, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 30px Oswald,"Arial Narrow",Arial'; g.fillText('DUNDER', w / 2, 34); g.fillText('MIFFLIN', w / 2, 70); g.font = '600 15px Arial'; g.fillText('PAPER COMPANY, INC.', w / 2, 104); });
  const vinylM = signMat(vinyl, { transparent: true, depthWrite: false });
  // frame: jambs, header, threshold, center mullion stop
  for (const sx of [-1, 1]) box(0.07, 2.42, 0.22, alu, sx * 0.795, 1.21, Z1, scene, false);
  box(1.66, 0.1, 0.22, alu, 0, 2.39, Z1, scene, false); box(1.6, 0.02, 0.3, kick, 0, 0.01, Z1, scene, false);
  const LW = 0.77, LH = 2.3;
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.76, 0, Z1 + 0.04); scene.add(pivot);
    const d = -sx; // leaf runs from the hinge toward the middle
    const at = (u) => d * u; // local x for a distance u from the hinge
    box(0.06, LH, 0.05, alu, at(0.03), LH / 2 + 0.02, 0, pivot, false);            // hinge stile
    box(0.06, LH, 0.05, alu, at(LW - 0.03), LH / 2 + 0.02, 0, pivot, false);       // lock stile (meets the other leaf)
    box(LW, 0.09, 0.05, alu, at(LW / 2), LH - 0.025, 0, pivot, false);             // top rail
    box(LW, 0.24, 0.05, alu, at(LW / 2), 0.14, 0, pivot, false);                   // bottom rail
    box(LW - 0.04, 0.2, 0.054, kick, at(LW / 2), 0.13, 0, pivot, false);           // kick plate
    const gl = box(LW - 0.12, LH - 0.33, 0.014, doorGlass, at(LW / 2), 0.26 + (LH - 0.33) / 2, 0, pivot, false); gl.renderOrder = 2;
    // outside: vertical pull handle; inside: horizontal push bar
    box(0.03, 0.6, 0.03, handleM, at(LW - 0.13), 1.05, 0.09, pivot, false);
    for (const y of [0.78, 1.32]) box(0.03, 0.03, 0.07, handleM, at(LW - 0.13), y, 0.055, pivot, false);
    box(LW - 0.22, 0.045, 0.045, handleM, at(LW / 2), 1.02, -0.08, pivot, false);
    for (const u of [0.16, LW - 0.16]) box(0.03, 0.04, 0.07, handleM, at(u), 1.02, -0.045, pivot, false);
    const v = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), vinylM); v.position.set(at(LW / 2), 1.55, 0.012); pivot.add(v);
    FRONT_DOOR.leaves.push({ pivot, sx });
  }
  colliders.push(FRONT_DOOR.col);
  // the open leaves rest against the sidewalk side of the jambs: thin colliders there so you can't walk through the glass
  for (const sx of [-1, 1]) colliders.push({ minX: sx * 0.8 - 0.05, maxX: sx * 0.8 + 0.05, minZ: Z1 + 0.1, maxZ: Z1 + 0.9 });
}
function updateFrontDoor(dt, px, pz, lv) {
  const near = lv === 0 && Math.abs(px) < 2.6 && Math.abs(pz - Z1) < 2.6; // walk up from inside or out
  if (near) FRONT_DOOR.hold = 1.2; else FRONT_DOOR.hold = Math.max(0, (FRONT_DOOR.hold || 0) - dt);
  FRONT_DOOR.target = near || FRONT_DOOR.hold > 0 ? 1 : 0;
  const k = FRONT_DOOR.target ? 2.6 : 1.4; // opens briskly, closes gently
  FRONT_DOOR.open += Math.sign(FRONT_DOOR.target - FRONT_DOOR.open) * Math.min(Math.abs(FRONT_DOOR.target - FRONT_DOOR.open), k * dt);
  const e = FRONT_DOOR.open * FRONT_DOOR.open * (3 - 2 * FRONT_DOOR.open), ang = e * 1.62; // ~93 deg fully open
  for (const { pivot, sx } of FRONT_DOOR.leaves) pivot.rotation.y = sx * ang; // both swing out (+z) onto the sidewalk
  const shut = FRONT_DOOR.open < 0.45;
  FRONT_DOOR.col.minX = shut ? -0.8 : 1e9; FRONT_DOOR.col.maxX = shut ? 0.8 : 1e9;
}
// HQ #73 exterior walls; HQ #79: the warehouse is DOWNSTAIRS now (stairs off the west door), the lot was rebuilt (HQ #76)
// HQ #81: the office is on the 2nd floor of a 3-story building now; the site (lot, truck yard, grass) is all at ground level (BY)
const SITE = { x0: -28.4, x1: 24.4, z0: -10.6, z1: 35.4 };
colliders.push(
  { minX: X0 - 0.12, maxX: X1 + 0.12, minZ: Z0 - 0.12, maxZ: Z0 + 0.1 },                 // north window wall
  { minX: X1 - 0.1, maxX: X1 + 0.12, minZ: Z0 - 0.12, maxZ: Z1 + 0.12 },                 // east window wall
  { minX: X0 - 0.12, maxX: -0.8, minZ: Z1 - 0.1, maxZ: Z1 + 0.12 }, { minX: 0.8, maxX: X1 + 0.12, minZ: Z1 - 0.1, maxZ: Z1 + 0.12 }, // front wall + door gap
  { minX: X0 - 0.12, maxX: X0 + 0.1, minZ: Z0 - 0.12, maxZ: WH_DOOR[0] }, { minX: X0 - 0.12, maxX: X0 + 0.1, minZ: WH_DOOR[1], maxZ: Z1 + 0.12 }, // west wall + stair door
);
// HQ #79: two floors. Colliders for the warehouse downstairs live in BCOL; `colliders` is the street-level set (office + site).
// The stairwell runs west from the door by the water cooler: landing x -11..-12.2, 21 steps down to x -18.1, open into the warehouse at x -18.8.
const BY = -4.4, BH = 7.6;                                      // warehouse floor height, ceiling height (HQ #83: double-height, like the show's warehouse)
// HQ #83: warehouse stairs = the show's open steel switchback in the warehouse's NE corner. Top landing (y 0) outside the
// office door, flight A runs north down the east wall to a corner landing, flight B runs west down the north wall to the floor.
const WST = { xe: -11.12, xr: -12.3, zP: -2.85, zA0: -4.6, zA1: -6.78, zN: -7.88, xB1: -16.2, nA: 8, nB: 15 };
WST.rise = -BY / (WST.nA + WST.nB); WST.yM = -WST.rise * WST.nA;
const BASE = { x0: -27, x1: X0, z0: -8, z1: 10.1 };              // warehouse footprint (HQ #81: ground floor of the building's west wing)
const BCOL = [];
BCOL.push({ minX: -100, maxX: SITE.x0, minZ: -100, maxZ: 100 }, { minX: SITE.x1, maxX: 100, minZ: -100, maxZ: 100 },   // edge of the property (ground level)
  { minX: -100, maxX: 100, minZ: -100, maxZ: SITE.z0 }, { minX: -100, maxX: 100, minZ: SITE.z1, maxZ: 100 });
const WH_LOBBY_DOOR = [8.3, 9.5];                                // HQ #81: warehouse east-wall door into the ground-floor lobby hall

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
// HQ #90d: signs stay bright enough to read on iPad, but pick up a little office light instead of flat unlit cards.
function signMat(map, { transparent = false, alphaTest = 0, depthWrite = true } = {}) {
  return new THREE.MeshStandardMaterial({
    map, roughness: 0.84, metalness: 0,
    emissive: new THREE.Color('#ffffff'), emissiveMap: map, emissiveIntensity: 0.4,
    transparent, alphaTest, depthWrite,
  });
}
// a flat sign (canvas text) on a wall. ry: 0 faces +z (south), PI faces -z (north), PI/2 faces +x (east), -PI/2 faces -x (west)
function sign(text, x, y, z, ry, { w = 1.6, h = 0.32, bg = '#1f2a44', fg = '#ffffff', sub = '', font = 'system-ui,Segoe UI,Arial', weight = 800 } = {}) {
  let cw = 512, ch = Math.round(512 * h / w);
  if (ch > 512) { ch = 512; cw = Math.max(64, Math.round(512 * w / h)); }
  const tex = canvasTex(cw, ch, (g, w2, h2) => {
    if (bg) { roundRect(g, 2, 2, w2 - 4, h2 - 4, Math.min(18, h2 / 4)); g.fillStyle = bg; g.fill(); } else g.clearRect(0, 0, w2, h2);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = Math.round(h2 * (sub ? 0.46 : 0.6)); g.font = `${weight} ${fs}px ${font}`;
    while (g.measureText(text).width > w2 - 24 && fs > 10) { fs -= 2; g.font = `${weight} ${fs}px ${font}`; }
    g.fillText(text, w2 / 2, sub ? h2 * 0.38 : h2 / 2 + 2);
    if (sub) { g.globalAlpha = 0.85; g.font = `600 ${Math.round(h2 * 0.22)}px ${font}`; g.fillText(sub, w2 / 2, h2 * 0.78); g.globalAlpha = 1; }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMat(tex, { transparent: !bg }));
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
}
// HQ #42: show-style plaques. Icon Shop's PNGs (assets/signs/png, cream face, brown border, green rule) for the reception,
// conference door and company sign; plate() paints the rest of the office-park door plates in the same style.
const texLoader = new THREE.TextureLoader();
const SIGN_PNG = { reception: 213 / 512, conference: 329 / 512, 'dunder-mifflin': 155 / 512, sales: 256 / 512 };
function pngSign(name, x, y, z, ry, w) {
  const t = texLoader.load(`./assets/signs/png/sign-${name}-512.png`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = IS_MOBILE ? 4 : 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * SIGN_PNG[name]), signMat(t, { transparent: true, alphaTest: 0.04 }));
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
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMat(tex, { transparent: true }));
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
  // HQ #81: the rest of the building + the site. level 0 = 2nd floor (DM), -1 = ground floor / outside
  { id: 'hall',    name: '2nd-floor hallway (Vance Refrigeration across the hall)', x0: -11, x1: 11, z0: 7.5, z1: 10.1, outside: true, level: 0 },
  { id: 'elev',    name: 'the elevator',                       x0: 3.0,  x1: 5.0,  z0: 10.1, z1: 12.3, outside: true, level: 'any' },
  { id: 'mstairs', name: 'the building stairwell (1 ↔ 2)',     x0: 5.4,  x1: 8.2,  z0: 10.1, z1: 15.4, outside: true, level: 'any' },
  { id: 'stairs',  name: 'the metal stairs down to the warehouse (NE corner)', x0: -16.2, x1: -11, z0: -7.9, z1: -2.85, outside: true, level: 'any' },
  { id: 'warehouse', name: 'the warehouse (downstairs, ground floor)', x0: -27, x1: -11, z0: -8, z1: 10.1, outside: true, level: -1 },
  { id: 'lobbyhall', name: 'the building lobby (elevator + stairs)', x0: -11, x1: 8.4, z0: 7.7, z1: 10.1, outside: true, level: -1 },
  { id: 'lobby',   name: 'the building lobby (front entrance)', x0: -3.2, x1: 2.8, z0: 10.1, z1: 15.5, outside: true, level: -1 },
  { id: 'walk',    name: 'the front sidewalk (building entrance)', x0: -11.2, x1: 11.2, z0: 15.5, z1: 17.8, outside: true, level: -1 },
  { id: 'truck',   name: 'inside the box truck at Dock 1', x0: -17.15, x1: -14.65, z0: 10.2, z1: 15.3, outside: true, level: -1 },
  { id: 'yard',    name: 'the truck yard by the loading dock', x0: -27.4, x1: -11.1, z0: 10.2, z1: 17.8, outside: true, level: -1 },
  { id: 'lot',     name: 'the parking lot',                    x0: -20.2, x1: 24.4, z0: 17.8, z1: 35.4, outside: true, level: -1 },
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

// structural columns in the bullpen (HQ #101b: matte concrete + shared contact blob)
const COLUMNS = [[-5.9, 0.9], [1.2, -3.6]];
for (const [x, z] of COLUMNS) {
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, H, 20), M.concrete);
  col.position.set(x, H / 2, z); col.castShadow = col.receiveShadow = true; scene.add(col);
  contactBlob(x, z, 0.85, 0.85, 0.34);
  addCollider(x, z, 0.56, 0.56);
}
// floor finishes: vinyl in the kitchen / break room, rug in Michael's office, accounting carpet patch, conference carpet
{
  const k = box(5, 0.006, 3, M.vinyl, -8.5, 0.004, -6.0, scene, false); k.castShadow = false;
  const r = box(2.8, 0.008, 2.8, M.rug, 8.8, 0.005, 4.6, scene, false); r.castShadow = false;
  const a = box(4.2, 0.006, 2.2, M.carpetWarm, -3.6, 0.003, -1.0, scene, false); a.castShadow = false;
  const c = box(4.4, 0.006, 4.9, M.carpet, 8.75, 0.003, 0, scene, false); c.castShadow = false;
}
// HQ #101b: cheap window light shafts / soft bloom cards (additive, no postprocessing — iPad-safe)
if (!HQ_LOW) {
  const shaftTex = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,248,230,0)'); grd.addColorStop(0.15, 'rgba(255,245,220,0.55)');
    grd.addColorStop(0.55, 'rgba(255,240,210,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(w * 0.25, 0, w * 0.5, h);
    const g2 = g.createLinearGradient(0, 0, w, 0);
    g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = g2; g.fillRect(0, 0, w, h);
  });
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0.55 });
  // a few shafts from the north window wall into the bullpen
  [[-4.0, -6.1], [4.0, -5.9]].forEach(([x, z], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.25 + (i % 2) * 0.3, 3.5), shaftMat);
    m.position.set(x, 1.55, z + 1.9); m.rotation.x = -0.52; m.rotation.y = (i - 1) * 0.05;
    m.renderOrder = 2; scene.add(m);
  });
}

// ---------- outside view ----------
// HQ #81: everything outside sits at GROUND level (y = BY); the office is upstairs. Grass, road, trees, far buildings = GROUNDS
// (drawn on every floor: you see them out of DM's windows, 4.4 m up).
// HQ #101: layered foliage trees + windowed facade skyline (biggest visible win from the bullpen windows).
const GROUNDS = new THREE.Group(); GROUNDS.position.y = BY; scene.add(GROUNDS);
{
const gn0 = scene.children.length;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.ground);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
box(60, 0.02, 6, M.paving, 0, -0.01, -11.2, scene, false);
box(4, 0.02, 90, std('#3d3f43', 0.95), 22.6, -0.01, 10, scene, false); // Slough Avenue, past the lot entrance (HQ #76)
box(0.12, 0.005, 90, new THREE.MeshBasicMaterial({ color: '#e3c11e' }), 22.6, 0.002, 10, scene, false);
{
  // HQ #101b: fewer/smaller cross-card trees with real silhouettes — sky + skyline peek through
  // 4 variants on one atlas; 4 InstancedMeshes (variant × face/cross combined into 2 orientations × 2 UV sets = 4 draws)
  const treeAtlas = canvasTex(1024, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const kinds = [
      { name: 'oak', cols: ['#1e3a1c', '#2f5530', '#3d6b38', '#4f7d4a', '#6a9458'], wide: 1.0, tall: 0.92, lobes: 11 },
      { name: 'pine', cols: ['#16301a', '#224428', '#2f5530', '#3d6b38', '#4a7d44'], wide: 0.72, tall: 1.05, lobes: 7 },
      { name: 'maple', cols: ['#2a4018', '#3a5a28', '#4a6e34', '#5a823e', '#6e9850'], wide: 1.08, tall: 0.88, lobes: 13 },
      { name: 'poplar', cols: ['#1a3220', '#2a4a2c', '#3a6238', '#4a7a44', '#5a9050'], wide: 0.62, tall: 1.12, lobes: 9 },
    ];
    const cell = w / 2;
    kinds.forEach((kind, idx) => {
      const ox = (idx % 2) * cell + cell / 2, oy = ((idx / 2) | 0) * cell;
      const top = oy + cell * (kind.name === 'pine' || kind.name === 'poplar' ? 0.04 : 0.08);
      const mid = oy + cell * 0.42, ground = oy + cell - 4;
      // trunk
      g.fillStyle = kind.name === 'pine' ? '#3a2818' : '#4a3220';
      g.beginPath();
      g.moveTo(ox - 7 * kind.wide, ground); g.lineTo(ox + 7 * kind.wide, ground);
      g.lineTo(ox + 4, mid); g.lineTo(ox - 4, mid); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2;
      for (let y = mid; y < ground - 8; y += 16) { g.beginPath(); g.moveTo(ox - 3, y); g.lineTo(ox + 2, y + 5); g.stroke(); }
      // silhouette canopy — irregular scalloped outline (alpha outside = sky holes)
      g.fillStyle = kind.cols[0];
      g.beginPath();
      const lobes = kind.lobes, rx0 = cell * 0.38 * kind.wide, ry0 = (mid - top) * kind.tall;
      g.moveTo(ox, top);
      for (let i = 0; i <= lobes; i++) {
        const t = i / lobes, ang = -Math.PI + t * Math.PI;
        const wob = 0.75 + 0.35 * Math.sin(i * 2.7 + idx);
        const rx = rx0 * wob, ry = ry0 * (0.5 + 0.5 * Math.sin(t * Math.PI));
        g.lineTo(ox + Math.cos(ang) * rx, top + (mid - top) * 0.35 + Math.sin(Math.max(ang, -Math.PI)) * ry * 0.2 + t * (mid - top) * 0.55);
      }
      g.lineTo(ox + rx0 * 0.55, mid + 24); g.lineTo(ox - rx0 * 0.55, mid + 24); g.closePath(); g.fill();
      // layered foliage masses with gaps (not a solid green card)
      for (let layer = 1; layer < kind.cols.length; layer++) {
        g.fillStyle = kind.cols[layer];
        const y0 = top + layer * (cell * 0.05);
        const clumps = 5 + (idx + layer) % 4;
        for (let c = 0; c < clumps; c++) {
          const cx = ox + (c / (clumps - 1) - 0.5) * rx0 * 1.5;
          const cy = y0 + 20 + Math.sin(c * 1.7 + layer) * 18 + layer * 6;
          const rr = (22 + (c * 7 + layer * 5) % 18) * kind.wide;
          g.beginPath();
          for (let i = 0; i <= 10; i++) {
            const t = i / 10, a = t * Math.PI * 2;
            const wr = rr * (0.75 + 0.35 * Math.sin(t * 9 + c + idx));
            const x = cx + Math.cos(a) * wr, y = cy + Math.sin(a) * wr * 0.72;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.closePath(); g.fill();
        }
      }
      // punch translucent leaf gaps so cards aren't cardboard slabs
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 28; k++) {
        g.beginPath();
        g.ellipse(ox + (Math.random() - 0.5) * rx0 * 1.6, top + 30 + Math.random() * (mid - top), 4 + Math.random() * 10, 3 + Math.random() * 7, Math.random(), 0, 7);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      // leaf speckles + sun rim
      for (let k = 0; k < 120; k++) {
        const px = ox + (Math.random() - 0.5) * rx0 * 1.8, py = top + Math.random() * (mid - top + 30);
        g.fillStyle = Math.random() < 0.5 ? 'rgba(20,40,18,0.4)' : 'rgba(210,235,150,0.28)';
        g.fillRect(px, py, 2 + Math.random() * 3, 2);
      }
      g.strokeStyle = 'rgba(230,245,170,0.3)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(ox - 16, top + 50, 55 * kind.wide, -1.3, 0.35); g.stroke();
    });
  });
  treeAtlas.colorSpace = THREE.SRGBColorSpace;
  const treeMat = new THREE.MeshBasicMaterial({ map: treeAtlas, transparent: true, alphaTest: 0.32, depthWrite: true, side: THREE.DoubleSide, fog: true });
  // Plane tall enough that canopy reaches 2nd-floor windows (grounds sit at BY = -4.4)
  const TREE_H = 8.2, TREE_W = 5.0;
  function treePlane(variant) {
    const geo = new THREE.PlaneGeometry(TREE_W, TREE_H);
    const uvs = geo.attributes.uv;
    const col = variant % 2, row = (variant / 2) | 0;
    for (let i = 0; i < uvs.count; i++) {
      // canvas y=0 is top of atlas; flipY texture → map plane v so canopy is up
      uvs.setXY(i, col * 0.5 + uvs.getX(i) * 0.5, (1 - row) * 0.5 + uvs.getY(i) * 0.5);
    }
    return geo;
  }
  // 2 InstancedMeshes (variants 0/1 and 2/3 share? keep 4 for silhouette variety — still only 4 draws)
  const treeMeshes = [0, 1].map(v => new THREE.InstancedMesh(treePlane(v), treeMat, 56));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), pos = new THREE.Vector3();
  const counts = [0, 0];
  function placeTree(x, z, s, yaw0, variant, cross = true) {
    variant &= 1; if (counts[variant] >= 54) return;
    // GROUNDS-local: trunk at y≈0, canopy up into the window band
    pos.set(x, (TREE_H * 0.5) * s, z); s3.set(s, s, s);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw0);
    m4.compose(pos, q, s3); treeMeshes[variant].setMatrixAt(counts[variant]++, m4);
    if (!cross || counts[variant] >= 54) return;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw0 + Math.PI / 2);
    m4.compose(pos, q, s3); treeMeshes[variant].setMatrixAt(counts[variant]++, m4);
  }
  // Wide gaps so sky + skyline read through the north windows
  const nearXs = [-20, -14, -5, 4, 14, 21];
  for (const x of nearXs) {
    placeTree(x + (Math.random() - .5) * 1.2, -14.8 - Math.random() * 2.5, 0.82 + Math.random() * 0.22, (Math.random() - .5) * 0.2, (Math.random() * 2) | 0);
  }
  // mid layer — offset into the gaps of the near row
  for (let x = -32; x <= 32; x += 10) {
    placeTree(x + (Math.random() - .5) * 2, -22 - Math.random() * 9, 0.75 + Math.random() * 0.35, (Math.random() - .5) * 0.3, (Math.random() * 2) | 0);
  }
  // far layer
  for (let x = -44; x <= 46; x += 12) {
    placeTree(x + (Math.random() - .5) * 3, -40 - Math.random() * 16, 0.65 + Math.random() * 0.4, (Math.random() - .5) * 0.35, (Math.random() * 2) | 0, false);
  }
  for (let z = -24; z <= 16; z += 12) {
    placeTree(30 + Math.random() * 6, z, 0.7 + Math.random() * 0.3, -Math.PI / 2 + (Math.random() - .5) * 0.25, (Math.random() * 2) | 0);
  }
  treeMeshes.forEach((m, i) => { m.count = counts[i]; if (m.count) scene.add(m); });



  // City skyline: varied massing + shared windowed facade materials (still few meshes)
  const skyline = [
    // closer mid-distance row (peek through the tree line from the bullpen)
    [-48, 14, -42, 11, 16, 9, M.bldg],
    [-28, 9,  -48, 9, 20, 9, M.bldgBrick],
    [-10, 18, -48, 12, 26, 10, M.bldgDark],
    [8,   12, -44, 10, 17, 9, M.bldg],
    [24,  16, -50, 13, 22, 11, M.bldgBrick],
    [42,  8,  -44, 8, 13, 8, M.bldg],
    [58,  20, -50, 11, 28, 10, M.bldgDark],
    // farther row
    [-40, 6,  -88, 14, 12, 12, M.bldg],
    [-12, 24, -95, 10, 34, 10, M.bldgDark],
    [16,  10, -90, 15, 18, 13, M.bldgBrick],
    [40,  14, -92, 11, 22, 11, M.bldg],
  ];
  // HQ #101b: no separate roof-cap meshes (saves ~11 draws); coping baked into facade texture
  for (const [x, halfH, z, w, h, d, mat] of skyline) {
    const b = box(w, h, d, mat, x, h / 2, z, scene, false);
    b.castShadow = false; b.receiveShadow = true;
  }
  // distant soft haze strip (cheap mesh, sells depth)
  {
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(220, 28), new THREE.MeshBasicMaterial({
      color: '#c5d6e6', transparent: true, opacity: 0.35, depthWrite: false, fog: true, side: THREE.DoubleSide
    }));
    haze.position.set(0, 10, -120); scene.add(haze);
  }
}
for (const o of scene.children.slice(gn0)) GROUNDS.add(o);
}

// ---------- props ----------
const potGeo = new THREE.CylinderGeometry(0.22, 0.17, 0.45, HQ_HD ? 16 : 12), leafGeo = new THREE.SphereGeometry(0.26, HQ_HD ? 12 : 7, HQ_HD ? 8 : 5);
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
  // HQ #101b: same draw cost as round 1 chair; slight seat oversize for edge soft-read
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(0.50, 0.07, 0.48, M.chairSeat, 0, 0.50, -0.02, g);           // seat
  box(0.46, 0.52, 0.05, M.chair, 0, 0.82, 0.22, g);                  // back
  box(0.34, 0.10, 0.04, M.chairSeat, 0, 0.68, 0.205, g, false);     // lumbar
  for (const sx of [-1, 1]) {
    box(0.04, 0.16, 0.04, M.steel, sx * 0.26, 0.58, 0.0, g, false);
    box(0.05, 0.03, 0.20, M.chair, sx * 0.26, 0.67, -0.02, g, false);
  }
  box(0.05, 0.36, 0.05, M.steel, 0, 0.28, -0.02, g, false);
  box(0.56, 0.035, 0.055, M.steel, 0, 0.05, -0.02, g, false);
  box(0.055, 0.035, 0.56, M.steel, 0, 0.05, -0.02, g, false);
  const diag = box(0.50, 0.03, 0.045, M.steel, 0, 0.048, -0.02, g, false); diag.rotation.y = Math.PI / 4;
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
const mugGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.105, HQ_HD ? 16 : 12);
const mugHandleGeo = new THREE.TorusGeometry(0.028, 0.007, 6, HQ_HD ? 14 : 10);
const mugRimGeo = new THREE.TorusGeometry(0.039, 0.004, 5, HQ_HD ? 16 : 10);
const keyTex = canvasTex(256, 96, (g, w, h) => {
  g.fillStyle = '#e8e6e0'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) {
    const x = 6 + c * 17.5, y = 6 + r * 22;
    g.fillStyle = '#d4d1cb'; g.fillRect(x, y, 15, 18);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + 15, 15, 3);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 1, y + 1, 13, 2);
  }
});
const keyMat = new THREE.MeshStandardMaterial({ map: keyTex, roughness: 0.55, metalness: 0.05 });
const paperSheetMat = std('#f4f1ea', 0.85);
const blotterMat = std('#2a3a4a', 0.9);
const ceramicMat = (hex) => std(hex, 0.32, 0.05);
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
  // HQ #101b: Office desk — chamfer lip (bevel read) + contact shadow under footprint
  box(dw, 0.055, dd, st.hero ? M.walnut : M.oak, 0, 0.745, 0, g);                 // top
  box(dw + 0.028, 0.016, dd + 0.028, st.hero ? M.walnut : M.oak, 0, 0.714, 0, g); // chamfer ledge (bevel read)
  box(0.05, 0.70, dd - 0.08, M.steel, -dw / 2 + 0.05, 0.35, 0, g);                 // left leg
  box(0.44, 0.70, dd - 0.06, M.cabinet, dw / 2 - 0.24, 0.35, 0, g);                // drawer pedestal
  for (let d = 0; d < 3; d++) box(0.36, 0.015, 0.02, M.steel, dw / 2 - 0.24, 0.22 + d * 0.2, dd / 2 - 0.04, g, false); // drawer lines
  box(dw - 0.25, 0.40, 0.025, M.steel, -0.05, 0.46, -dd / 2 + 0.03, g);            // modesty panel
  // cable tray under front edge
  box(dw * 0.55, 0.03, 0.08, M.steel, 0, 0.68, dd / 2 - 0.06, g, false);
  contactBlob(st.x, st.z, dw * 1.15, dd * 1.85, 0.28); // covers desk + chair zone
  // monitor with bezel + neck + weighted base
  const mw = st.hero ? 1.25 : 0.72, mh = mw * 300 / 512;
  const mz = -dd / 2 + 0.17, my = 0.77 + 0.14 + mh / 2;
  box(mw + 0.05, mh + 0.05, 0.028, M.bezel, 0, my, mz - 0.016, g);                 // outer bezel
  box(mw + 0.02, mh + 0.02, 0.02, M.steel, 0, my, mz - 0.028, g, false);           // rear shell
  box(0.045, 0.18, 0.04, M.bezel, 0, 0.83, mz - 0.05, g);                          // neck
  box(0.28, 0.02, 0.18, M.bezel, 0, 0.772, mz - 0.02, g);                          // base plate
  box(0.08, 0.025, 0.08, M.steel, 0, 0.79, mz - 0.05, g, false);                   // hinge joint
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
flushContactShadows(); // HQ #101b: one InstancedMesh for desk/column AO blobs
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
  const tw = 512, th = Math.max(64, Math.min(512, Math.round(512 * h / w)));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), signMat(canvasTex(tw, th, draw)));
  m.position.z = 0.014; g.add(m); return g;
}
const paintBuilding = (g, w, h) => { // Pam's watercolor of the office building
  g.fillStyle = '#eef4fa'; g.fillRect(0, 0, w, h);
  const sky = g.createLinearGradient(0, 0, 0, h * 0.6); sky.addColorStop(0, '#9cc6ea'); sky.addColorStop(1, '#eef4fa'); g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.6);
  g.fillStyle = '#9db28a'; g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillStyle = '#a0634c'; g.fillRect(w * 0.12, h * 0.14, w * 0.76, h * 0.6);                       // HQ #81: the 3-story brick building
  g.fillStyle = '#5d6f80'; for (let r = 0; r < 3; r++) g.fillRect(w * 0.15, h * (0.2 + r * 0.18), w * 0.7, h * 0.08);
  g.fillStyle = 'rgba(230,220,200,.7)'; for (let r = 0; r < 3; r++) g.fillRect(w * 0.12, h * (0.3 + r * 0.18), w * 0.76, h * 0.012);
  g.fillStyle = '#3b4148'; g.fillRect(w * 0.45, h * 0.64, w * 0.1, h * 0.1);
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
  // HQ #79: the warehouse is downstairs, stairs through the west door by the cooler (plate by the front door points the way)
  plate('WAREHOUSE ↓', -1.45, 2.05, Z1 - 0.115, Math.PI, { w: 0.62, sub: 'STAIRS · WEST DOOR BY THE COOLER' });
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

// HQ #90d: lived-in desks + show-style boards. One vertex-colored mesh for the clutter; posters are ≤512 canvases.
function addOfficeLife() {
  const P = [], Nv = [], C = [];
  const col = new THREE.Color();
  const paper = new THREE.BoxGeometry(0.2, 0.007, 0.26);
  const sticky = new THREE.BoxGeometry(0.08, 0.0035, 0.08);
  const pen = new THREE.CylinderGeometry(0.005, 0.005, 0.13, 5);
  const phone = new THREE.BoxGeometry(0.055, 0.014, 0.11);
  const cup = new THREE.CylinderGeometry(0.038, 0.032, 0.07, 8);
  const tray = new THREE.BoxGeometry(0.24, 0.015, 0.18);
  const clipB = new THREE.BoxGeometry(0.18, 0.01, 0.24);
  const addM = (geo, color, m4) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m4);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    col.set(color);
    for (let i = 0; i < pa.length; i += 3) {
      P.push(pa[i], pa[i + 1], pa[i + 2]); Nv.push(na[i], na[i + 1], na[i + 2]); C.push(col.r, col.g, col.b);
    }
    g.dispose();
  };
  const compose = (x, y, z, rx, ry, rz, sx, sy, sz) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const put = (geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => addM(geo, color, compose(x, y, z, rx, ry, rz, sx, sy, sz));
  const place = (st, geo, color, lx, ly, lz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    addM(geo, color, compose(st.x, 0, st.z, 0, st.ry, 0, 1, 1, 1).multiply(compose(lx, ly, lz, rx, ry, rz, sx, sy, sz)));
  };
  const NOTES = { grok: '#fff3b0', inbox: '#f4efe4', cos: '#d6e6ff', assist: '#ffe082', icons: '#ffd7a8', onpad: '#f8d0e0', builder: '#f3efe4', faith: '#f6d5de', broker: '#e6eef8', conn: '#fff6d8', review: '#ececec', kids: '#d7f0e2', designer: '#ffd0ea', profile: '#e4e7ea' };
  for (const s of stations) {
    const sc = s.hero ? 1.25 : 1;
    place(s, paper, '#f4f1ea', -0.42 * sc, 0.792, 0.16);
    place(s, paper, '#fffdf8', -0.4 * sc, 0.8, 0.17, 0, 0.12, 0, 0.9, 1, 0.88);
    place(s, sticky, NOTES[s.id] || '#fff59d', 0.36 * sc, 0.78, 0.0, 0, 0.35, 0);
    place(s, pen, '#1a3a8a', 0.1 * sc, 0.786, 0.24, 0, 0.4, Math.PI / 2);
  }
  const byId = id => stations.find(s => s.id === id);
  const mike = byId('grok'); if (mike) { place(mike, paper, '#efe8dc', 0.48, 0.8, -0.02, 0, -0.25, 0, 1.05, 4, 0.95); place(mike, phone, '#2a2e34', -0.1, 0.8, 0.24); }
  const dw = byId('assist'); if (dw) place(dw, pen, '#c62828', -0.15, 0.788, 0.22, 0, 0.2, 1.15);
  const kv = byId('conn'); if (kv) ['#e53935', '#fdd835', '#43a047', '#1e88e5'].forEach((c, i) => place(kv, sticky, c, 0.12 + i * 0.045, 0.78, -0.12, 0, i * 0.4, 0, 0.42, 1, 0.65));
  const oc = byId('broker'); if (oc) { place(oc, paper, '#f7f5f0', -0.18, 0.786, -0.06, 0, 0.02, 0, 0.75, 1, 0.75); place(oc, paper, '#e7eef6', -0.16, 0.794, -0.04, 0, -0.05, 0, 0.7, 1, 0.7); }
  const ang = byId('faith'); if (ang) place(ang, sticky, '#f8bbd0', 0.18, 0.786, 0.18, 0, -0.2, 0, 0.7, 1, 0.85);
  const andy = byId('icons'); if (andy) place(andy, cup, '#f6f3ec', 0.22, 0.82, 0.14);
  const kel = byId('designer'); if (kel) place(kel, phone, '#e11d74', -0.12, 0.8, 0.18, 0, 0.5, 0, 0.75, 1, 1.25);
  const tob = byId('profile'); if (tob) place(tob, sticky, '#eceff1', -0.2, 0.786, 0.16, 0, 0.15, 0, 1.3, 1, 0.75);
  const rx = -0.2, rz = 4.82, ty = 1.185;
  put(clipB, '#f3efe4', rx - 0.2, ty, rz + 0.02, 0, 0.18, 0);
  put(pen, '#b71c1c', rx + 0.02, ty + 0.01, rz + 0.06, 0, 0.2, 1.05);
  put(cup, '#2a2c30', rx + 0.55, ty + 0.04, rz - 0.02);
  put(pen, '#1a3a8a', rx + 0.54, ty + 0.09, rz - 0.02, 0.15, 0, 0.05);
  put(pen, '#c62828', rx + 0.57, ty + 0.09, rz, -0.1, 0.4, 0.08);
  put(pen, '#2e7d32', rx + 0.53, ty + 0.08, rz + 0.01, 0.05, 0.8, -0.1);
  put(tray, '#d9d3c6', rx + 1.43, ty, rz - 0.58);
  put(paper, '#f7f4ee', rx + 1.43, ty + 0.02, rz - 0.58, 0, 0.08, 0, 0.72, 5, 0.7);
  put(tray, '#c5d0c0', rx - 1.43, ty, rz - 0.5);
  put(phone, '#1c1e22', rx - 1.43, ty + 0.02, rz - 0.85);
  put(paper, '#fff8c4', rx - 0.85, ty, rz, 0, -0.25, 0, 0.65, 1, 0.5);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nv, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.02 }));
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'officeLife'; scene.add(mesh);
  for (const g of [paper, sticky, pen, phone, cup, tray, clipB]) g.dispose();
}
addOfficeLife();
function paintCork(notes) {
  return (g, w, h) => {
    g.fillStyle = '#c4894e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { const v = 80 + Math.random() * 80 | 0; g.fillStyle = `rgba(${v},${(v * 0.55) | 0},28,0.3)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    for (const n of notes) {
      g.save(); g.translate(n.x * w, n.y * h); g.rotate(n.rot || 0);
      const nw = n.w * w, nh = n.h * h;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-nw / 2 + 3, -nh / 2 + 4, nw, nh);
      g.fillStyle = n.c; g.fillRect(-nw / 2, -nh / 2, nw, nh);
      g.fillStyle = n.pin || '#c62828'; g.beginPath(); g.arc(0, -nh / 2 + 8, 5, 0, 7); g.fill();
      g.fillStyle = '#241c14'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${Math.max(12, Math.round(nh * 0.2))}px Arial,Helvetica,sans-serif`;
      const lines = n.t.split('\n');
      lines.forEach((ln, k) => g.fillText(ln, 0, (k - (lines.length - 1) / 2) * Math.round(nh * 0.22) + 4));
      g.restore();
    }
  };
}
// bullpen cork (west wall) + a smaller one by reception. Stylized notes, no photographic logos.
framed(-10.86, 1.58, 0.9, Math.PI / 2, 1.2, 0.9, paintCork([
  { x: 0.22, y: 0.24, w: 0.3, h: 0.3, rot: -0.05, c: '#fff59d', t: 'PRETZEL\nDAY' },
  { x: 0.52, y: 0.22, w: 0.32, h: 0.28, rot: 0.04, c: '#fff', t: 'Dundie\nnominations' },
  { x: 0.8, y: 0.26, w: 0.28, h: 0.3, rot: 0.07, c: '#ffccbc', t: 'Lost stapler\ncheck Jell-O' },
  { x: 0.24, y: 0.55, w: 0.32, h: 0.28, rot: 0.04, c: '#c5e1a5', t: 'SCHRUTE FARMS\nbeets' },
  { x: 0.54, y: 0.56, w: 0.28, h: 0.26, rot: -0.06, c: '#b3e5fc', t: 'FLONKERTON\ntryouts' },
  { x: 0.8, y: 0.58, w: 0.24, h: 0.22, rot: 0.1, c: '#f8bbd0', pin: '#1565c0', t: 'PARKOUR' },
  { x: 0.28, y: 0.82, w: 0.34, h: 0.22, rot: -0.02, c: '#fff', t: 'It is your\nbirthday.' },
  { x: 0.66, y: 0.82, w: 0.36, h: 0.24, rot: 0.03, c: '#fff8e1', t: 'Identity theft\nis not a joke' },
]));
framed(-4.7, 1.72, 7.36, Math.PI, 0.95, 0.7, paintCork([
  { x: 0.28, y: 0.32, w: 0.4, h: 0.36, rot: -0.04, c: '#fff', t: 'PLEASE\nSIGN IN' },
  { x: 0.72, y: 0.3, w: 0.38, h: 0.34, rot: 0.05, c: '#fff59d', t: 'Visitor\nbadges' },
  { x: 0.3, y: 0.72, w: 0.4, h: 0.32, rot: 0.03, c: '#ffccbc', t: 'Out of\ntoner' },
  { x: 0.72, y: 0.72, w: 0.38, h: 0.32, rot: -0.05, c: '#e3f2fd', t: 'Copier code\nask Pam' },
]));
framed(9.55, 1.72, 7.36, Math.PI, 0.58, 0.86, (g, w, h) => {
  g.fillStyle = '#0e1016'; g.fillRect(0, 0, w, h);
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1a140c'); sky.addColorStop(0.55, '#0e1016'); sky.addColorStop(1, '#2a2112');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = '#d7b15a'; g.textAlign = 'center';
  g.font = '700 28px Georgia,serif'; g.fillText('THREAT LEVEL', w / 2, h * 0.14);
  g.font = '900 46px Georgia,serif'; g.fillText('MIDNIGHT', w / 2, h * 0.24);
  g.fillStyle = '#c8ccd4';
  g.beginPath(); g.arc(w * 0.48, h * 0.42, 28, 0, 7); g.fill();
  g.fillRect(w * 0.48 - 22, h * 0.46, 44, 78);
  g.fillStyle = '#8d939e'; g.fillRect(w * 0.48 + 16, h * 0.52, 62, 7);
  g.fillStyle = '#f3ead6'; g.font = '600 16px Georgia,serif';
  g.fillText('AGENT MICHAEL SCARN', w / 2, h * 0.84);
  g.font = '600 13px Arial'; g.fillText('a very serious film', w / 2, h * 0.9);
});
framed(-7.4, 1.85, 7.36, Math.PI, 0.9, 0.55, (g, w, h) => {
  g.fillStyle = '#f3ead6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3d5c3a'; g.fillRect(w * 0.12, h * 0.46, w * 0.76, 5);
  g.fillStyle = '#2c2416'; g.textAlign = 'center';
  g.font = '700 34px Georgia,serif'; g.fillText('DUNDER MIFFLIN', w / 2, h * 0.28);
  g.font = '600 16px Arial'; g.fillText('PAPER COMPANY  ·  SCRANTON', w / 2, h * 0.4);
  g.font = '700 22px Georgia,serif'; g.fillText('Limitless paper', w / 2, h * 0.68);
  g.fillText('in a paperless world', w / 2, h * 0.84);
});

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

// ---------- warehouse stairs (HQ #79 -> rebuilt for HQ #83 / #82) ----------
// Show reference (OfficeTally set photo "Dunder Mifflin warehouse stairway", S3 "Back from Vacation", S2 "Boys and Girls"):
// the office is upstairs, the warehouse below, joined by an OPEN STEEL STAIR tucked in the warehouse corner: black steel
// stringers, open treads, square-tube posts with top + mid rails (scaffold look), a switchback landing in the corner, and a
// steel top landing in front of a plain steel door into the upstairs. Rebuilt to match: door by the cooler -> top landing ->
// flight A down the east wall -> corner landing -> flight B down the north wall -> warehouse floor.
// iPad: every stair part is merged into a handful of meshes (one per material) in WSTAIR, drawn only when the warehouse is.
const WSTAIR = new THREE.Group(); scene.add(WSTAIR); const ws0Mark = scene.children.length;
const WHD = { open: 0, pivot: null, col: { minX: X0 - 0.12, maxX: X0 + 0.1, minZ: WH_DOOR[0], maxZ: WH_DOOR[1] } };
{
  const S = WST, steelM = std('#26292d', 0.5, 0.65), treadM = std('#4a4e54', 0.55, 0.6), galvM = std('#8c9298', 0.4, 0.7), yelM = std('#e8c21c', 0.6);
  const parts = new Map(); // material -> [geometry]
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const put = (mat, geo) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo); };
  const bx = (mat, w, h, d, x, y, z) => put(mat, new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  // beam between two points (profile w x h, h kept "up")
  const beam = (mat, a, b, w, h) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), f = B.clone().sub(A), len = f.length(); f.normalize();
    const r = new THREE.Vector3(0, 1, 0).cross(f).normalize(), u = f.clone().cross(r).normalize();
    const g = new THREE.BoxGeometry(w, h, len); g.applyMatrix4(_m.makeBasis(r, u, f).setPosition(A.add(B).multiplyScalar(0.5))); put(mat, g);
  };
  const post = (x, z, y0, y1, s0 = 0.05) => bx(steelM, s0, y1 - y0, s0, x, (y0 + y1) / 2, z);
  const clamp = (x, z, y) => bx(galvM, 0.075, 0.075, 0.075, x, y, z);             // scaffold couplers at the joints
  const RT = 1.0, RM = 0.52;                                                        // top + mid rail heights over the nosing line
  const xc = (S.xr + S.xe) / 2, zc = (S.zN + S.zA1) / 2, runA = (S.zA0 - S.zA1) / S.nA, runB = (S.xr - S.xB1) / S.nB;
  // top landing (y 0) + corner landing (y yM): steel deck + toe kick, square-tube legs to the warehouse floor, X bracing
  bx(treadM, S.xe - S.xr, 0.06, S.zP - S.zA0, xc, -0.03, (S.zP + S.zA0) / 2);
  bx(treadM, S.xe - S.xr, 0.06, S.zA1 - S.zN, xc, S.yM - 0.03, zc);
  bx(steelM, S.xe - S.xr, 0.18, 0.06, xc, -0.12, S.zP); bx(steelM, 0.06, 0.18, S.zP - S.zA0, S.xr, -0.12, (S.zP + S.zA0) / 2);
  bx(yelM, S.xe - S.xr, 0.012, 0.05, xc, 0.006, S.zA0 + 0.03);                      // safety edge where the stairs drop away
  for (const z of [S.zP, S.zA0]) { post(S.xr, z, BY, 0, 0.08); post(S.xe - 0.05, z, BY, 0, 0.08); }
  for (const [x, z] of [[S.xr, S.zA1], [S.xr, S.zN + 0.05]]) post(x, z, BY, S.yM, 0.08);
  beam(steelM, [S.xr, BY + 0.2, S.zP], [S.xr, -0.3, S.zA0], 0.04, 0.04); beam(steelM, [S.xr, BY + 0.2, S.zA0], [S.xr, -0.3, S.zP], 0.04, 0.04);
  beam(steelM, [S.xr, BY + 0.2, S.zA1], [S.xr, S.yM - 0.3, S.zN + 0.05], 0.04, 0.04);
  // treads (open, no risers) + side stringers. Flight A: z zA0 -> zA1 going down; flight B: x xr -> xB1 going down
  for (let i = 0; i < S.nA - 1; i++) { const y = -(i + 1) * S.rise, z = S.zA0 - (i + 0.5) * runA; bx(treadM, S.xe - S.xr - 0.08, 0.04, runA + 0.03, xc, y - 0.02, z); bx(galvM, S.xe - S.xr - 0.08, 0.02, 0.03, xc, y - 0.01, z + runA / 2); }
  for (let i = 0; i < S.nB; i++) { const y = S.yM - (i + 1) * S.rise, x = S.xr - (i + 0.5) * runB; bx(treadM, runB + 0.03, 0.04, S.zA1 - S.zN - 0.08, x, y - 0.02, zc); bx(galvM, 0.03, 0.02, S.zA1 - S.zN - 0.08, x + runB / 2, y - 0.01, zc); }
  for (const x of [S.xr + 0.03, S.xe - 0.05]) beam(steelM, [x, -0.1, S.zA0 + 0.05], [x, S.yM - 0.1, S.zA1], 0.05, 0.26);
  for (const z of [S.zA1 - 0.03, S.zN + 0.05]) beam(steelM, [S.xr, S.yM - 0.1, z], [S.xB1 - 0.1, BY + 0.05, z], 0.05, 0.26);
  // open-side guard rails (square tube posts, top + mid rails, couplers): top landing south + west, flight A west, flight B south
  const yA = (z) => S.yM * (S.zA0 - z) / (S.zA0 - S.zA1), yB = (x) => S.yM + (BY - S.yM) * (S.xr - x) / (S.xr - S.xB1);
  for (const [x0, x1] of [[S.xe, S.xr]]) for (const h of [RT, RM]) beam(steelM, [x0, h, S.zP], [x1, h, S.zP], 0.045, 0.045);
  for (const h of [RT, RM]) beam(steelM, [S.xr, h, S.zP], [S.xr, h, S.zA0], 0.045, 0.045);
  for (const h of [RT, RM]) beam(steelM, [S.xr, h, S.zA0], [S.xr, S.yM + h, S.zA1], 0.045, 0.045);
  for (const h of [RT, RM]) beam(steelM, [S.xr, S.yM + h, S.zA1], [S.xB1 + 0.05, BY + h, S.zA1], 0.045, 0.045);
  for (const [x, z, y] of [[S.xe - 0.05, S.zP, 0], [xc, S.zP, 0], [S.xr, S.zP, 0], [S.xr, S.zA0, 0]]) { post(x, z, y, y + RT + 0.04); clamp(x, z, y + RT); clamp(x, z, y + RM); }
  for (let k = 1; k <= 2; k++) { const z = S.zA0 - (S.zA0 - S.zA1) * k / 2, y = yA(z); post(S.xr, z, y, y + RT + 0.04); clamp(S.xr, z, y + RT); clamp(S.xr, z, y + RM); }
  for (let k = 1; k <= 4; k++) { const x = S.xr - (S.xr - S.xB1) * k / 4, y = yB(x); post(x, S.zA1, y, y + RT + 0.04); clamp(x, S.zA1, y + RT); clamp(x, S.zA1, y + RM); }
  // wall-side handrails on brackets (east wall along flight A, north wall along flight B)
  beam(galvM, [S.xe - 0.08, 0.9, S.zA0], [S.xe - 0.08, S.yM + 0.9, S.zA1], 0.04, 0.04);
  beam(galvM, [S.xr, S.yM + 0.9, S.zN + 0.08], [S.xB1, BY + 0.9, S.zN + 0.08], 0.04, 0.04);
  for (let k = 0; k <= 2; k++) { const z = S.zA0 - 0.2 - k * 0.9; bx(galvM, 0.08, 0.03, 0.03, S.xe - 0.04, yA(z) + 0.87, z); }
  for (let k = 0; k <= 4; k++) { const x = S.xr - 0.3 - k * 0.85; bx(galvM, 0.03, 0.03, 0.08, x, yB(x) + 0.87, S.zN + 0.04); }
  // steel door frame on the warehouse side + a closer arm
  for (const z of WH_DOOR) bx(steelM, 0.08, 2.3, 0.07, S.xe - 0.04, 1.15, z);
  bx(steelM, 0.08, 0.08, WH_DOOR[1] - WH_DOOR[0] + 0.07, S.xe - 0.04, 2.3, (WH_DOOR[0] + WH_DOOR[1]) / 2);
  for (const [mat, list] of parts) { const g = mergeBoxes(list); const m = new THREE.Mesh(g, mat); m.castShadow = false; m.receiveShadow = true; WSTAIR.add(m); }
  // the door itself (steel, narrow wire-glass lite, push bar), hinged on the south jamb, swings out onto the top landing
  const officeSide = new Set(); // these stay drawn with the office (door leaf, its office-side frame + plate)
  const pv = new THREE.Group(); pv.position.set(X0 - 0.12, 0, WH_DOOR[1] - 0.02); scene.add(pv); WHD.pivot = pv; officeSide.add(pv);
  const dw = WH_DOOR[1] - WH_DOOR[0] - 0.04;
  box(0.05, 2.37, dw, M.whDoor, 0, 1.185, -dw / 2, pv, false);
  box(0.056, 0.7, 0.14, std('#9fb4c0', 0.1, 0.3), 0, 1.5, -dw + 0.28, pv, false);
  for (const sx of [-1, 1]) box(0.04, 0.04, dw - 0.25, galvM, sx * 0.05, 1.0, -dw / 2 - 0.05, pv, false);
  colliders.push(WHD.col);
  // stair light (count of lights never changes; it just sits up here now)
  const stairLight = new THREE.PointLight('#fff4e0', 5, 10, 2); stairLight.position.set(-12.4, 1.8, -5.4); scene.add(stairLight);
  // signs, mounted (not hanging): warehouse side over the door, at the foot of the stairs, on the corner landing; office side over the door
  plate('DUNDER MIFFLIN', S.xe - 0.01, 2.62, (WH_DOOR[0] + WH_DOOR[1]) / 2, -Math.PI / 2, { w: 0.8, sub: 'OFFICE · SUITE 200 · AUTHORIZED' });
  plate('↑ OFFICE', S.xB1 - 0.7, BY + 1.9, S.zN + 0.015, 0, { w: 0.62, sub: 'STAIRS · DUNDER MIFFLIN' });
  plate('WATCH YOUR STEP', S.xr + 0.6, S.yM + 1.75, S.zN + 0.015, 0, { w: 0.6 });
  officeSide.add(plate('WAREHOUSE', X0 + 0.115, 2.72, (WH_DOOR[0] + WH_DOOR[1]) / 2, Math.PI / 2, { w: 0.85, sub: '↓ STAIRS DOWN · AUTHORIZED PERSONNEL' }));
  for (const z of WH_DOOR) officeSide.add(box(0.26, 2.42, 0.08, M.walnut, X0 + 0.04, 1.21, z, scene, false));
  officeSide.add(box(0.26, 0.08, WH_DOOR[1] - WH_DOOR[0] + 0.08, M.walnut, X0 + 0.04, 2.42, (WH_DOOR[0] + WH_DOOR[1]) / 2, scene, false));
  // colliders. 2nd-floor set (level 0): top landing + flight A + corner landing + upper flight B, closed by rails + walls.
  // Ground set (level -1): lower flight B rail + the space under flight A / top landing is solid (no walking under the stairs).
  const railA = { minX: S.xr - 0.08, maxX: S.xr, minZ: S.zA1, maxZ: S.zP + 0.08 }, railP = { minX: S.xr - 0.08, maxX: X0 - 0.1, minZ: S.zP, maxZ: S.zP + 0.08 };
  const railB = { minX: S.xB1 - 0.02, maxX: S.xr, minZ: S.zA1, maxZ: S.zA1 + 0.08 }, northW = { minX: S.xB1 - 1, maxX: X0, minZ: S.zN - 0.3, maxZ: S.zN };
  colliders.push(railA, railP, railB, northW, { minX: X0 - 0.14, maxX: X0, minZ: S.zN - 0.3, maxZ: Z0 });
  BCOL.push(railB, { minX: S.xr - 0.08, maxX: X0, minZ: S.zA1, maxZ: S.zP + 0.1 });
  for (const o of scene.children.slice(ws0Mark)) if (!o.isLight && o !== WSTAIR && !officeSide.has(o)) WSTAIR.add(o);
}
function updateWhDoor(dt, px, pz, lv) {
  const near = lv === 0 && player.y > -1.0 && Math.hypot(px - X0, pz - (WH_DOOR[0] + WH_DOOR[1]) / 2) < 2.4;
  WHD.hold = near ? 1.0 : Math.max(0, (WHD.hold || 0) - dt);
  const target = near || WHD.hold > 0 ? 1 : 0, k = target ? 2.4 : 1.3;
  WHD.open += Math.sign(target - WHD.open) * Math.min(Math.abs(target - WHD.open), k * dt);
  const e = WHD.open * WHD.open * (3 - 2 * WHD.open); WHD.pivot.rotation.y = e * 1.55;
  const shut = WHD.open < 0.45; WHD.col.minX = shut ? X0 - 0.12 : 1e9; WHD.col.maxX = shut ? X0 + 0.1 : 1e9;
}
// merge a list of (non-indexed or indexed) BufferGeometries that share position/normal/uv into one
function mergeBoxes(list) {
  let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count; pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); uv.set(g.attributes.uv.array, ov * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[oi + i] = a[i] + ov; oi += a.length; } else { for (let i = 0; i < c; i++) idx[oi + i] = ov + i; oi += c; }
    ov += c; g.dispose();
  }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); m.setIndex(new THREE.BufferAttribute(idx, 1));
  m.computeBoundingSphere(); return m;
}

// ---------- the warehouse, downstairs (HQ #73 content, moved under the site for HQ #79) ----------
// Bare concrete + painted block, orange pallet racking full of paper, Darryl's foreman desk, forklift + pallet jack,
// the basketball hoop, the loading dock. Built at floor y = 0 and dropped into BASEMENT (y = BY); its colliders go to BCOL.
// HQ #84: working bay doors on the warehouse's south wall. Dock 1 is truck level (ramp up to a dock platform, the box truck is
// backed up to it and its rear door rolls up too, so you can walk into the truck); Dock 2 is a ground-level drive-through door
// out to the truck yard. Both roll up when you walk up (inside or out), drop shut behind you, block while closed.
// The curtains live in their own group (BAYG) so they draw from both the warehouse and the yard; only animated while near.
const BAY = { dh: 3.2, doors: [
  { id: 1, x0: -17.4, x1: -14.4, sill: 0.75, open: 0, hold: 0, curtain: null, col: null, truck: true },
  { id: 2, x0: -22.6, x1: -19.6, sill: 0, open: 0, hold: 0, curtain: null, col: null },
], truckDoor: null, ramp: { z0: 6.3, z1: 8.3 }, truckZ1: 15.2, told: 0 };
const BAYG = new THREE.Group(); BAYG.position.y = BY; BAYG.visible = false; scene.add(BAYG);
const BASEMENT = new THREE.Group(); BASEMENT.position.y = BY; BASEMENT.visible = false; scene.add(BASEMENT);
// HQ #95: Darryl sits at his foreman desk; HQ #96: between desk stretches he drives the forklift / pushes the pallet jack (warehouse-work.js)
const DARRYL_AT = { x: -12.15, z: 0.6, ry: -Math.PI / 2 }; let DARRYL = null, WH = null;
function animateDarryl(t, pl) {
  const d = DARRYL; if (!d) return;
  const breath = Math.sin(t * 1.7), cyc = (t / 22) % 1;
  const u = Math.min(1, Math.max(0, Math.min((cyc - 0.62) / 0.06, (1 - cyc) / 0.06))), typ = 1 - u; // 0 working the keyboard .. 1 sat back, hands folded
  d.body.position.set(0, -0.27, -0.04);
  d.legL.rotation.x = d.legR.rotation.x = 1.45; d.kneeL.rotation.x = d.kneeR.rotation.x = -1.4;
  const k = t * 8, tl = 0.42 + Math.max(0, Math.sin(k)) ** 2 * 0.06, tr = 0.42 + Math.max(0, Math.sin(k + 1.9)) ** 2 * 0.06;
  const az = 0.16 * typ + 0.3 * u, el = 1.0 * typ + 1.2 * u;
  d.armL.rotation.set(tl * typ + 0.42 * u, 0, az); d.armR.rotation.set(tr * typ + 0.42 * u, 0, -az); d.elbowL.rotation.x = el; d.elbowR.rotation.x = el;
  d.spine.rotation.set(-0.06 * typ - 0.02 * u + breath * 0.012, 0, 0); d.torso.scale.set(1 + breath * 0.012, 1, 1 + breath * 0.02);
  let hx = 0.12 * typ, hy = u * Math.sin(t * 0.9) * 0.6 + typ * Math.sin(t * 0.37) * 0.1;
  if (pl.level === -1) { const dx = pl.pos.x - DARRYL_AT.x, dz = pl.pos.z - DARRYL_AT.z; // look up at Chris when he walks over
    if (Math.hypot(dx, dz) < 3.2) { let a = Math.atan2(-dx, -dz) - DARRYL_AT.ry; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) < 1.6) { hy = hy * 0.2 + a * 0.8; hx *= 0.2; } } }
  d.headG.rotation.set(-(hx + breath * 0.015), hy, 0);
}
const whLight = new THREE.PointLight('#fff1d6', 0, 15, 1.6), whLight2 = new THREE.PointLight('#fff1d6', 0, 15, 1.6);
whLight.position.set(-22.5, BY + 5.4, -3.5); whLight2.position.set(-15.0, BY + 5.4, 0.4); scene.add(whLight, whLight2);
{
  const n0 = scene.children.length, c0 = colliders.length;
  const conc = std('#a9a8a3', 0.95), block = std('#d4cfc2', 0.92), rackOr = std('#e2701f', 0.55, 0.3), rackBl = std('#2a5ca8', 0.55, 0.3);
  const yel = new THREE.MeshBasicMaterial({ color: '#e8c21c' }), B = BASE, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, ww = B.x1 - B.x0, wd = B.z1 - B.z0, t = 0.24;
  box(ww, 0.02, wd, conc, cx, 0.0, cz, scene, false);                                        // slab
  // ceiling (with the stair opening left out): north, south, and the strip west of the stairs
  const ceilM = std('#8f949a', 0.9, 0, { emissive: '#9aa0a6', emissiveIntensity: 0.25 });
  for (const [x0, x1, z0, z1] of [[B.x0, B.x1, B.z0, B.z1]]) { // HQ #83: double height, no stair hole (the stairs are inside it now)
    const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), ceilM); c.rotation.x = Math.PI / 2; c.position.set((x0 + x1) / 2, BH, (z0 + z1) / 2); scene.add(c);
  }
  // exposed steel joists under the ceiling (one instanced mesh)
  { const n = Math.floor(ww / 1.6), j = new THREE.InstancedMesh(boxGeo(0.12, 0.3, 1), rackBl.clone(), n * 2), m4 = new THREE.Matrix4(); j.material.color.set('#55595f'); let k = 0;
    const seg = (x, z0, z1) => j.setMatrixAt(k++, m4.makeScale(1, 1, z1 - z0).setPosition(x, BH - 0.15, (z0 + z1) / 2));
    for (let i = 0; i < n; i++) { const x = B.x0 + 0.8 + i * 1.6; seg(x, B.z0, B.z1); }
    j.count = k; scene.add(j); }
  // walls: N, W, E (office door up on the top landing + lobby door below), S with the dock door
  const dh = BAY.dh;
  box(ww + t / 2 - 0.12, BH, t, block, (B.x0 - t / 2 + B.x1 - 0.12) / 2, BH / 2, B.z0, scene, false);
  box(t, BH, wd, block, B.x0, BH / 2, cz, scene, false);
  // HQ #83: east wall = full block up to the office floor (local -BY); above that only a thin skin behind the office's own wall
  const eastW = (z0, z1, y0, y1) => { if (z1 <= z0 || y1 <= y0) return; const lo = Math.min(y1, -BY);
    if (lo > y0) box(t, lo - y0, z1 - z0, block, B.x1, (y0 + lo) / 2, (z0 + z1) / 2, scene, false);
    const hi = Math.max(y0, -BY); if (y1 > hi) box(0.035, y1 - hi, z1 - z0, block, B.x1 - t / 2 + 0.0175, (hi + y1) / 2, (z0 + z1) / 2, scene, false); };
  eastW(B.z0, WH_DOOR[0], 0, BH); eastW(WH_DOOR[1], WH_LOBBY_DOOR[0], 0, BH); eastW(WH_LOBBY_DOOR[1], B.z1, 0, BH);
  eastW(WH_DOOR[0], WH_DOOR[1], 0, -BY); eastW(WH_DOOR[0], WH_DOOR[1], -BY + 2.42, BH);
  eastW(WH_LOBBY_DOOR[0], WH_LOBBY_DOOR[1], 2.3, BH);
  // HQ #81: steel door (propped open) through to the building lobby + plates on the warehouse side
  for (const z of WH_LOBBY_DOOR) box(t + 0.06, 2.32, 0.08, M.whDoor, B.x1, 1.16, z, scene, false);
  box(0.05, 2.2, 1.12, M.whDoor, B.x1 - 0.65, 1.1, WH_LOBBY_DOOR[0] - 0.02 - 0.0, scene, false).rotation.y = Math.PI / 2;
  plate('LOBBY · ELEVATOR', B.x1 - 0.14, 2.62, (WH_LOBBY_DOOR[0] + WH_LOBBY_DOOR[1]) / 2, -Math.PI / 2, { w: 0.9, sub: 'STAIRS UP TO DUNDER MIFFLIN · 2' });
  // HQ #84: south wall with two bay openings (Dock 2 west, Dock 1 east) + headers above them
  { const D2 = BAY.doors[1], D1 = BAY.doors[0];
    for (const [a, b2] of [[B.x0, D2.x0], [D2.x1, D1.x0], [D1.x1, B.x1]]) box(b2 - a, BH, t, block, (a + b2) / 2, BH / 2, B.z1, scene, false);
    for (const d of BAY.doors) box(d.x1 - d.x0, BH - dh, t, block, (d.x0 + d.x1) / 2, (BH + dh) / 2, B.z1, scene, false); }
  box(ww, 1.1, 0.02, std('#5d7d9a', 0.9), cx, 0.55, B.z0 + t / 2 + 0.01, scene, false);         // painted dado band, like the show's warehouse
  // HQ #84: the bay doors. Each: hood (coil box) + vertical guide channels inside, slatted steel curtain that rolls up into the
  // wall, a collider that drops out once the curtain is above head height, hazard stripes on the jambs.
  { const slatTex = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#c4c8cc'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { g.fillStyle = '#9ea3a8'; g.fillRect(0, y, w, 3); g.fillStyle = '#dde0e3'; g.fillRect(0, y + 3, w, 2); } });
    slatTex.wrapS = slatTex.wrapT = THREE.RepeatWrapping;
    const hood = std('#3a3a3a', 0.8), chan = std('#55595f', 0.5, 0.6), stripeTex = canvasTex(32, 256, (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#1b1b1b' : '#e8c21c'; g.fillRect(0, i * 16, w, 16); } });
    const stripe = new THREE.MeshBasicMaterial({ map: stripeTex });
    for (const d of BAY.doors) {
      const w = d.x1 - d.x0, cx = (d.x0 + d.x1) / 2, ch = dh - d.sill;
      const tex = slatTex.clone(); tex.needsUpdate = true; tex.repeat.set(w / 1.0, ch / 1.0);
      const cur = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, ch, 0.06), std('#ffffff', 0.5, 0.45, { map: tex }));
      cur.position.set(cx, d.sill + ch / 2, B.z1); cur.receiveShadow = true; BAYG.add(cur); d.curtain = cur; d.ch = ch;
      // bottom bar + handle (move with the curtain)
      const bar = new THREE.Mesh(boxGeo(w - 0.02, 0.06, 0.1), std('#2b2e33', 0.5, 0.6)); bar.position.set(0, -ch / 2 + 0.03, 0); cur.add(bar);
      const hdl = new THREE.Mesh(boxGeo(0.22, 0.04, 0.16), std('#9aa0a6', 0.3, 0.8)); hdl.position.set(0, -ch / 2 + 0.25, 0); cur.add(hdl);
      box(w + 0.3, 0.42, 0.5, hood, cx, dh + 0.26, B.z1 - 0.3, scene, false);                                   // coil hood
      for (const x of [d.x0, d.x1]) { box(0.1, dh - d.sill, 0.14, chan, x + (x === d.x0 ? 0.05 : -0.05), d.sill + (dh - d.sill) / 2, B.z1 - 0.14, scene, false);
        const st = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1.4), stripe); st.position.set(x + (x === d.x0 ? -0.09 : 0.09), d.sill + 0.7, B.z1 - t / 2 - 0.006); st.rotation.y = Math.PI; scene.add(st); }
      d.col = { minX: d.x0, maxX: d.x1, minZ: B.z1 - 0.2, maxZ: B.z1 + 0.2 };
    }
    // Dock 1 (truck level): sill in the wall, concrete dock platform, ramp down into the warehouse, yellow pipe rails on the sides
    const D1 = BAY.doors[0], w1 = D1.x1 - D1.x0, c1 = (D1.x0 + D1.x1) / 2, R = BAY.ramp, sl = D1.sill;
    box(w1, sl, t, block, c1, sl / 2, B.z1, scene, false);
    const dockC = std('#b9b7b0', 0.9); box(w1, sl, B.z1 - R.z1, dockC, c1, sl / 2, (R.z1 + B.z1) / 2, scene, false);
    { const L = R.z1 - R.z0, a = Math.atan2(sl, L), rp = box(w1 - 0.02, 0.06, Math.hypot(L, sl), std('#7d8288', 0.55, 0.5), c1, sl / 2 - 0.03, (R.z0 + R.z1) / 2, scene, false); rp.rotation.x = -a;
      for (const x of [D1.x0 + 0.04, D1.x1 - 0.04]) { const sd = box(0.08, 0.06, Math.hypot(L, sl), new THREE.MeshBasicMaterial({ color: '#e8c21c' }), x, sl / 2 + 0.01, (R.z0 + R.z1) / 2, scene, false); sd.rotation.x = -a; }
      // tread lines on the ramp (one instanced mesh)
      const n = 9, tr = new THREE.InstancedMesh(boxGeo(w1 - 0.2, 0.012, 0.04), std('#55595f', 0.6, 0.5), n), m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; tr.setMatrixAt(i, m4.makeRotationX(-a).setPosition(c1, sl * f + 0.006, R.z0 + L * f)); } scene.add(tr); }
    box(w1, 0.012, 0.25, new THREE.MeshBasicMaterial({ map: stripeTex }), c1, sl + 0.006, B.z1 - 0.26, scene, false).rotation.y = 0;   // dock edge stripe
    const railM = std('#e8c21c', 0.5, 0.3);
    for (const x of [D1.x0 + 0.06, D1.x1 - 0.06]) {
      box(0.05, 0.05, B.z1 - R.z0 - 0.2, railM, x, 1.05 + sl * 0.6, (R.z0 + B.z1) / 2 - 0.1, scene, false).rotation.x = -Math.atan2(sl, (B.z1 - R.z0)) * 0.5;
      for (const z of [R.z0 + 0.15, R.z1, B.z1 - 0.3]) { const y0 = z <= R.z1 ? sl * (z - R.z0) / (R.z1 - R.z0) : sl; box(0.05, 1.05, 0.05, railM, x, y0 + 0.52, z, scene, false); }
    }
    colliders.push({ minX: D1.x0 - 0.05, maxX: D1.x0 + 0.1, minZ: R.z0, maxZ: B.z1 }, { minX: D1.x1 - 0.1, maxX: D1.x1 + 0.05, minZ: R.z0, maxZ: B.z1 });
  }
  colliders.push(
    { minX: B.x0, maxX: B.x1, minZ: B.z0 - 1, maxZ: B.z0 + t / 2 + 0.02 }, { minX: B.x0 - 1, maxX: B.x0 + t / 2 + 0.02, minZ: B.z0, maxZ: B.z1 },
    { minX: B.x0, maxX: BAY.doors[1].x0, minZ: B.z1 - t / 2 - 0.02, maxZ: B.z1 + 0.14 }, { minX: BAY.doors[1].x1, maxX: BAY.doors[0].x0, minZ: B.z1 - t / 2 - 0.02, maxZ: B.z1 + 0.14 },
    { minX: BAY.doors[0].x1, maxX: B.x1, minZ: B.z1 - t / 2 - 0.02, maxZ: B.z1 + 0.14 }, BAY.doors[0].col, BAY.doors[1].col,
    { minX: B.x1 - t / 2 - 0.02, maxX: B.x1 + 0.14, minZ: B.z0, maxZ: WH_LOBBY_DOOR[0] }, { minX: B.x1 - t / 2 - 0.02, maxX: B.x1 + 0.14, minZ: WH_LOBBY_DOOR[1], maxZ: B.z1 + 0.12 });
  // high-bay lamps (one instanced shade + one instanced glow disc)
  { const spots = []; for (const x of [-25, -21.5, -18, -14.5]) for (const z of [-5.5, 3.6, 8.2]) spots.push([x, z]);
    const sh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.38, 0.3, 12, 1, true), std('#5d6166', 0.5, 0.6), spots.length);
    const gl = new THREE.InstancedMesh(new THREE.CircleGeometry(0.34, 12), M.light, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z], i) => { sh.setMatrixAt(i, m4.makeTranslation(x, BH - 0.55, z)); gl.setMatrixAt(i, m4.compose(new THREE.Vector3(x, BH - 0.7, z), q, one)); });
    scene.add(sh, gl); }
  // safety lines: forklift aisle + the walkway off the stairs
  box(0.08, 0.005, 13, yel, -24.6, 0.015, -1, scene, false); box(0.08, 0.005, 13, yel, -20.2, 0.015, -1, scene, false);
  box(2.4, 0.005, 0.08, yel, WST.xB1 - 1.3, 0.015, WST.zA1 + 0.25, scene, false);
  { const hz = canvasTex(256, 64, (g, w, h) => { for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#1b1b1b' : '#e8c21c'; g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32, h); g.lineTo(i * 32 - 32, h); g.fill(); } });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(WST.zA1 - WST.zN, 0.5), new THREE.MeshBasicMaterial({ map: hz })); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2; m.position.set(WST.xB1 - 0.35, 0.016, (WST.zN + WST.zA1) / 2); scene.add(m); }
  // pallet racking. Loads are single textured blocks (cheap on iPad)
  const loadTex = paperTex.clone(); loadTex.wrapS = loadTex.wrapT = THREE.RepeatWrapping; loadTex.repeat.set(3, 2); loadTex.needsUpdate = true;
  const load = std('#ffffff', 0.85, 0, { map: loadTex });
  function rack(x, z0, z1, depth, levels = [0.15, 1.5, 2.85], free = []) { // free: [slot, level] left open for Darryl's forklift (HQ #96)
    const n = Math.round((z1 - z0) / 2.6);
    for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; for (const dx of [-depth / 2, depth / 2]) box(0.09, 3.95, 0.09, rackOr, x + dx, 1.975, z, scene, false); }
    for (const y of levels.slice(1)) for (const dx of [-depth / 2, depth / 2]) box(0.07, 0.14, z1 - z0, rackBl, x + dx, y - 0.07, (z0 + z1) / 2, scene, false);
    for (let i = 0; i < n; i++) {
      const zm = z0 + (z1 - z0) * (i + 0.5) / n, bw = (z1 - z0) / n - 0.25;
      levels.forEach((y, li) => {
        if ((i * 7 + li * 3 + Math.round(x)) % 5 === 4) return; // a few empty slots
        if (free.some(([a, b]) => a === i && b === li)) return;
        box(depth - 0.1, 0.12, bw, M.pallet, x, y + 0.06, zm, scene, false);
        const hgt = 0.85 + ((i + li) % 3) * 0.12; box(depth - 0.2, hgt, bw - 0.12, load, x, y + 0.12 + hgt / 2, zm, scene, false);
      });
    }
    addCollider(x, (z0 + z1) / 2, depth + 0.12, z1 - z0 + 0.12);
  }
  rack(-26.25, -7.3, 5.3, 1.1);       // along the west wall
  rack(-22.4, -7.2, -1.6, 1.1, undefined, [[1, 0], [1, 1]]);       // middle runs, gap in the middle so you can cut across
  rack(-22.4, 1.6, 5.4, 1.1, undefined, [[0, 0], [0, 1]]);          // HQ #96: east-face slots Darryl loads / unloads
  // a single shrink-wrapped pallet of paper (pallet + one textured load)
  const ptex = paperTex.clone(); ptex.wrapS = ptex.wrapT = THREE.RepeatWrapping; ptex.repeat.set(2, 3); ptex.needsUpdate = true; const pload = std('#ffffff', 0.85, 0, { map: ptex });
  function pallet(x, z, h = 1.1, ry = 0) { box(1.2, 0.14, 1.0, M.pallet, x, 0.07, z, scene, false).rotation.y = ry; box(1.1, h, 0.92, pload, x, 0.14 + h / 2, z, scene, false).rotation.y = ry; addCollider(x, z, 1.25, 1.05, ry); }
  pallet(-11.95, 4.9, 1.3); // HQ #96: the other floor pallets are movable now (warehouse-work.js)
  // Darryl's foreman corner: HQ #83 moved it off the NE corner (the stairs live there now) to the east wall, south of the stairs
  box(0.7, 0.05, 1.4, M.oak, -11.55, 0.74, 0.6); box(0.05, 0.7, 1.35, M.steel, -11.22, 0.36, 0.6); addCollider(-11.55, 0.6, 0.7, 1.4);
  chair(scene, -12.15, 0.6, -Math.PI / 2);
  box(0.32, 0.02, 0.24, std('#7a5a35', 0.8), -11.5, 0.77, 0.3, scene, false); box(0.04, 0.16, 0.06, std('#222', 0.6), -11.4, 0.85, 1.1, scene, false);
  box(0.02, 0.3, 0.5, std('#2a2a2a', 0.6), -11.24, 1.05, 0.6, scene, false);                                // old CRT-ish monitor
  plate('WAREHOUSE FOREMAN', B.x1 - 0.13, 2.1, 0.6, -Math.PI / 2, { w: 0.85, sub: 'D. PHILBIN' });
  sign('0 DAYS WITHOUT AN ACCIDENT', -20.0, 2.45, B.z0 + 0.13, 0, { w: 1.5, h: 0.42, bg: '#1b5e20', fg: '#ffffff', weight: 800 });
  cabinets(-11.45, 2.3, 2, -Math.PI / 2);
  // under the stairs: mop bucket + a couple of boxes (like the set photo)
  box(0.4, 0.35, 0.35, std('#f2c200', 0.6), -11.75, 0.18, -3.4, scene, false); box(0.6, 0.45, 0.5, M.cardboard || std('#b08a5a', 0.9), -11.8, 0.23, -5.2, scene, false);
  // the basketball hoop (Basketball, S1) on the north wall over the open floor
  { const hx = -17.4, hz = B.z0 + 0.13; box(1.2, 0.8, 0.04, M.white, hx, 3.3, hz + 0.1, scene, false); box(0.46, 0.34, 0.045, std('#c62828', 0.6), hx, 3.17, hz + 0.11, scene, false);
    box(0.4, 0.3, 0.05, M.white, hx, 3.17, hz + 0.115, scene, false);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.015, 6, 20), std('#e65100', 0.4, 0.5)); rim.rotation.x = Math.PI / 2; rim.position.set(hx, 3.0, hz + 0.42); scene.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.35, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#fafafa', wireframe: true })); net.position.set(hx, 2.82, hz + 0.42); scene.add(net);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), std('#d35400', 0.7)); ball.position.set(-16.6, 0.12, -5.4); scene.add(ball);
    const key = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#f2f2ee'; g.lineWidth = 4; g.strokeRect(30, 0, 68, 90); g.beginPath(); g.arc(64, 90, 34, 0, Math.PI); g.stroke(); });
    const km = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: key, transparent: true, depthWrite: false })); km.rotation.x = -Math.PI / 2; km.position.set(hx, 0.014, B.z0 + 1.7); scene.add(km); }
  // HQ #96: forklift + pallet jack are built (and driven by Darryl) in warehouse-work.js, created below
  plate('LOADING DOCK', (BAY.doors[0].x0 + BAY.doors[0].x1) / 2, 3.95, B.z1 - 0.14, Math.PI, { w: 1.1, sub: 'DOCK 1 · TRUCK LEVEL' });
  plate('DOCK 2', (BAY.doors[1].x0 + BAY.doors[1].x1) / 2, 3.95, B.z1 - 0.14, Math.PI, { w: 0.9, sub: 'GROUND LEVEL · TO THE YARD' });
  plate('DUNDER MIFFLIN', -24.0, 3.1, B.z1 - 0.14, Math.PI, { w: 1.8, sub: 'WAREHOUSE · SHIPPING & RECEIVING' });
  // Darryl himself, at his desk (static, no AI: he's set dressing until a warehouse bot exists)
  // HQ #95: he used to stand frozen beside his empty chair with one arm stuck out. Now he sits in it and works (animateDarryl)
  // HQ #96: and between desk stretches he drives the forklift / pushes the pallet jack, reorganizing the racks + floor
  // HQ #95/#96: warehouse-work.js owns Darryl (desk sit + forklift + pallet jack). Fallback = desk-only if it throws.
  try { WH = createWarehouseWork({ THREE, parent: scene, box, std, M, loadMat: pload, colliders, buildCharacter, desk: DARRYL_AT }); DARRYL = WH.rig; }
  catch (e) { console.warn('HQ #96 warehouse work failed, Darryl stays at his desk', e);
    const dar = buildCharacter({ id: 'darryl', name: 'Darryl Philbin', color: '#3d5a80' }); scene.add(dar.root); addCollider(DARRYL_AT.x, DARRYL_AT.z, 0.55, 0.55); DARRYL = dar;
    WH = { update: (t, pl) => animateDarryl(t, pl) }; }
  DARRYL.root.position.set(DARRYL_AT.x, 0, DARRYL_AT.z); DARRYL.root.rotation.y = DARRYL_AT.ry;
  // move everything built above into the basement group, and its colliders into the downstairs set
  const made = scene.children.slice(n0); for (const o of made) BASEMENT.add(o);
  BCOL.push(...colliders.splice(c0));
}
// HQ #85: Design Trainer wall screen. Warehouse east wall between the steel stairs and Darryl's desk (where Chris pointed:
// standing at x -15.6, z -1.7 facing east). Tinder-style KEEP / PASS on the designer's real Printful + Tapstitch ideas (swipe.js).
const SWIPE_AT = { x: BASE.x1 - 0.13, z: -1.5, y: 1.8 };
// HQ #92: Suggestion Box overlay (iPad keyboard) — opened from the wall's SUGGEST button
const suggestBox = createSuggestBox({
  toast: (...a) => toast(...a),
  getContext: () => { const c = swipeWall.curCard?.(); return { cardId: c?.id || null, cardTitle: c?.title || '', deckId: swipeWall.deckId?.() || null }; },
  onSent: ({ text }) => { try { swipeWall.noteSent?.(text); } catch (e) {} },
  onOpenChange: open => { if (open) { try { document.exitPointerLock?.(); } catch (e) {} } },
});
const swipeWall = createSwipeWall({ THREE, parent: BASEMENT, x: SWIPE_AT.x, y: SWIPE_AT.y, z: SWIPE_AT.z, ry: -Math.PI / 2, w: 2.4, h: 1.5, sendSwipes, toast: (...a) => toast(...a),
  onSuggest: ctx => suggestBox.show(ctx || {}) });
BASEMENT.add(plate('DESIGN TRAINER', SWIPE_AT.x - 0.01, SWIPE_AT.y + 1.03, SWIPE_AT.z, -Math.PI / 2, { w: 1.1, sub: 'SWIPE ▶ KEEP · ◀ PASS · ✉ SUGGEST' }));
// HQ #92b: a real wall-mounted SUGGESTION BOX right under the Design Trainer screen (the exact spot Chris pointed at:
// standing x -13.6, z -1.6 facing east). Oak box with a brass slot + card pocket, labeled face. Tap / aim + A opens the
// Suggestion Box overlay (iPad keyboard) → type:'suggest' → design-train/suggestions.jsonl for Kelly's next deck.
let SUGGEST_MESH = null;
{ const sx = SWIPE_AT.x - 0.1, sy = 0.66, sz = SWIPE_AT.z, oak = M.oak || std('#7a5a35', 0.8);
  box(0.2, 0.46, 0.56, oak, sx, sy, sz, BASEMENT, false);                                  // body (depth along x, width along z)
  box(0.24, 0.04, 0.6, std('#4a3420', 0.8), sx - 0.02, sy + 0.25, sz, BASEMENT, false);    // sloped-look lid cap
  box(0.03, 0.03, 0.34, std('#c9a24a', 0.35, 0.8), sx - 0.1, sy + 0.15, sz, BASEMENT, false); // brass slot frame
  box(0.032, 0.012, 0.3, std('#140e08', 0.9), sx - 0.105, sy + 0.15, sz, BASEMENT, false);    // the slot
  box(0.1, 0.16, 0.14, std('#3a2a18', 0.85), sx - 0.14, sy - 0.12, sz + 0.36, BASEMENT, false); // card pocket (side)
  for (const dz of [-0.03, 0, 0.03]) box(0.01, 0.12, 0.09, std('#f6f1e4', 0.9), sx - 0.13, sy - 0.04, sz + 0.36 + dz * 0.3, BASEMENT, false); // blank cards
  const tex = canvasTex(512, 300, (g, cw, ch) => {
    g.fillStyle = '#6e4f2c'; g.fillRect(0, 0, cw, ch);
    roundRect(g, 18, 70, cw - 36, ch - 88, 14); g.fillStyle = '#f3ead6'; g.fill();
    g.strokeStyle = '#c9a24a'; g.lineWidth = 6; roundRect(g, 26, 78, cw - 52, ch - 104, 10); g.stroke();
    g.fillStyle = '#2c2416'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 64px ${PLATE_FONT}`; g.fillText('SUGGESTION BOX', cw / 2, 140);
    g.fillStyle = '#3d5c3a'; g.fillRect(cw * 0.18, 186, cw * 0.64, 5);
    g.fillStyle = '#2c2416'; g.font = '700 30px Arial,Helvetica,sans-serif'; g.fillText('✉ NEW PHRASES · DESIGN IDEAS', cw / 2, 222);
    g.fillStyle = '#6b4f12'; g.font = '700 24px Arial,Helvetica,sans-serif'; g.fillText('TAP / A TO DROP ONE IN · FOR KELLY', cw / 2, 258);
  });
  SUGGEST_MESH = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.316), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  SUGGEST_MESH.position.set(sx - 0.102, sy - 0.06, sz); SUGGEST_MESH.rotation.y = -Math.PI / 2; BASEMENT.add(SUGGEST_MESH);
}
// hangPlate() with a custom ceiling height (the warehouse ceiling is higher than the office's)
function hangPlateAt(make, x, y, z, ry, w, ceil) {
  make(x, y, z + Math.cos(ry) * 0.006, ry); make(x, y, z - Math.cos(ry) * 0.006, ry + Math.PI);
  for (const dx of [-w * 0.35, w * 0.35]) box(0.012, ceil - y - 0.15, 0.012, M.steel, x + Math.cos(ry) * dx, (ceil + y + 0.15) / 2, z - Math.sin(ry) * dx, scene, false);
}

// ---------- outside: building facade, sidewalk + entrance, parking lot (HQ #73, redone for HQ #76) ----------
// A real office-park lot like the show's: sidewalk + entrance canopy along the front, then a double-loaded lot
// (row A nose-in to the curb, 6.4 m drive aisle, row B), painted stalls + wheel stops, curbed end islands with trees,
// ADA stalls + hatched access aisle at the door, RESERVED posts for the Regional Manager + Asst. to the R.M.,
// a LOADING ZONE with the Dunder Mifflin box truck, light poles, and the SCRANTON BUSINESS PARK sign.
// Everything here sits in one group (OUTSIDE) that's hidden while you're downstairs. Repeated bits are instanced.
const OUTSIDE = new THREE.Group(); scene.add(OUTSIDE);
const DZ = 8.0; // HQ #81: lot shift south (pre-shift z + DZ = world z), and the whole group sits at ground level (BY)
{
  const n0 = scene.children.length, c0 = colliders.length;
  const concrete = std('#c9c4ba', 0.95), curbM = std('#d5d1c8', 0.9), grass = std('#7fa35c', 1);
  const asphTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#3b3d41'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 40 + Math.random() * 50; g.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + Math.random() * 0.4})`; g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6); }
    g.strokeStyle = 'rgba(20,20,22,.5)'; g.lineWidth = 1.2; for (let k = 0; k < 3; k++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let s = 0; s < 6; s++) { x += (Math.random() - .5) * 40; y += (Math.random() - .5) * 40; g.lineTo(x, y); } g.stroke(); } }, [10, 4]);
  const asph = std('#ffffff', 0.95, 0, { map: asphTex });
  const paint = new THREE.MeshBasicMaterial({ color: '#ecebe4' }), yellow = new THREE.MeshBasicMaterial({ color: '#e3c11e' });
  const LOT = { x0: -20, x1: 20.6, z0: 9.8, z1: 26.6 };
  const flat = (tex, w, d, x, z, rz = 0, transparent = true) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent, depthWrite: false, toneMapped: false })); m.rotation.x = -Math.PI / 2; m.rotation.z = rz; m.position.set(x, 0.014, z); scene.add(m); return m; };
  // HQ #81: the building facade, entrance + canopy moved to the building section (EXT). This group is the site at ground level,
  // built in the old HQ #76 coordinates and then slid south by DZ (the building's south block + hallway sit where the old sidewalk was).
  box(22.4, 0.14, 2.2, concrete, 0, 0.05, (Z1 + 0.1 + LOT.z0) / 2, scene, false);                 // sidewalk along the building front
  // HQ #81: truck yard in front of the warehouse loading dock (west wing), open to the lot
  box(16.3, 0.03, 7.7, asph, -19.25, -0.005, 5.95, scene, false);
  flat(canvasTex(512, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#e3c11e'; g.font = '800 64px Oswald,"Arial Narrow",Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NO PARKING · DOCK', w / 2, h / 2 + 4); }), 4.2, 1.05, -15.9, 4.6, 0);
  flat(canvasTex(512, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#e3c11e'; g.font = '800 64px Oswald,"Arial Narrow",Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KEEP CLEAR · DOCK 2', w / 2, h / 2 + 4, w - 24); }), 4.2, 1.05, -21.1, 3.6, 0);
  { const jt = new THREE.InstancedMesh(boxGeo(0.02, 0.005, 2.2), std('#a9a49a', 1), 22), m4 = new THREE.Matrix4(); for (let i = 0; i < 22; i++) jt.setMatrixAt(i, m4.makeTranslation(-10.5 + i, 0.123, 8.7)); scene.add(jt); }
  // the lot: one asphalt slab, curbed on every side (open to the road on the east, at the drive aisle)
  box(LOT.x1 - LOT.x0, 0.03, LOT.z1 - LOT.z0, asph, (LOT.x0 + LOT.x1) / 2, -0.005, (LOT.z0 + LOT.z1) / 2, scene, false);
  const curb = (x0, x1, z0, z1) => { box(x1 - x0, 0.16, z1 - z0, curbM, (x0 + x1) / 2, 0.06, (z0 + z1) / 2, scene, false); };
  curb(LOT.x0 - 0.2, LOT.x0, LOT.z0 - 0.2, LOT.z1 + 0.2); curb(LOT.x0, LOT.x1, LOT.z1, LOT.z1 + 0.2);
  curb(LOT.x0, -11.2, LOT.z0 - 0.2, LOT.z0); curb(11.2, LOT.x1, LOT.z0 - 0.2, LOT.z0);
  curb(LOT.x1, LOT.x1 + 0.2, LOT.z0 - 0.2, 15.0); curb(LOT.x1, LOT.x1 + 0.2, 21.4, LOT.z1 + 0.2);
  // stall lines (row A z 9.8..15, row B z 21.4..26.6) + wheel stops, all instanced
  const LX = []; for (let k = -7; k <= 6; k++) LX.push(1.35 + 2.7 * k);
  { const ln = new THREE.InstancedMesh(boxGeo(0.11, 0.005, 4.9), paint, LX.length * 2), m4 = new THREE.Matrix4(); let i = 0;
    for (const x of LX) { ln.setMatrixAt(i++, m4.makeTranslation(x, 0.013, 12.35)); ln.setMatrixAt(i++, m4.makeTranslation(x, 0.013, 24.05)); } scene.add(ln);
    const ws = new THREE.InstancedMesh(boxGeo(1.8, 0.12, 0.16), concrete, (LX.length - 1) * 2); i = 0;
    for (let k = 0; k < LX.length - 1; k++) { const cx = (LX[k] + LX[k + 1]) / 2; if (Math.abs(cx) < 0.1) continue; ws.setMatrixAt(i++, m4.makeTranslation(cx, 0.06, 10.5)); ws.setMatrixAt(i++, m4.makeTranslation(cx, 0.06, 25.9)); }
    ws.count = i; ws.castShadow = true; scene.add(ws); }
  // ADA stalls either side of a hatched access aisle right in front of the doors, + a curb ramp
  flat(canvasTex(128, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#2f6fd1'; g.lineWidth = 10; for (let y = -w; y < h + w; y += 34) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + w); g.stroke(); } g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }), 2.55, 4.8, 0, 12.35);
  const ada = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#1565c0'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '700 84px system-ui,Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♿', w / 2, h / 2 + 4); });
  for (const x of [-2.7, 2.7]) flat(ada, 1.3, 1.3, x, 13.2, 0, false);
  box(1.6, 0.02, 0.9, std('#bdb6a8', 0.95), 0, 0.07, LOT.z0 - 0.35, scene, false).rotation.x = -0.12; // curb ramp at the aisle
  box(1.6, 0.004, 0.3, yellow, 0, 0.14, LOT.z0 - 0.2, scene, false);
  // painted RESERVED in the two boss stalls, drive-aisle arrows, LOADING ZONE box
  const word = (txt, col = '#ecebe4') => canvasTex(256, 96, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = col; g.font = '800 54px Oswald,"Arial Narrow",Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 3); });
  const rsv = word('RESERVED'); for (const x of [5.4, 8.1]) flat(rsv, 2.0, 0.75, x, 14.2, 0);
  const arrow = canvasTex(128, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#ecebe4'; g.fillRect(52, 90, 24, 160); g.beginPath(); g.moveTo(64, 8); g.lineTo(112, 100); g.lineTo(16, 100); g.fill(); });
  flat(arrow, 0.9, 1.8, 8, 17.0, -Math.PI / 2); flat(arrow, 0.9, 1.8, -4, 19.6, Math.PI / 2);
  flat(canvasTex(512, 220, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#e3c11e'; g.lineWidth = 10; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#e3c11e'; g.font = '800 46px Oswald,"Arial Narrow",Arial'; g.textAlign = 'center'; g.fillText('LOADING ZONE', w / 2, h - 26); }), 7.6, 3.2, -14.6, 18.2);
  // posts: RESERVED (Michael + Dwight), ADA, VISITOR
  function postSign(text, sub, x, z, ry, w = 0.55) {
    box(0.05, 1.7, 0.05, M.steel, x, 0.85, z, scene, false); addCollider(x, z, 0.2, 0.2);
    const nx = 0.035 * Math.sin(ry), nz = 0.035 * Math.cos(ry);
    plate(text, x + nx, 1.85, z + nz, ry, { w, sub }); plate(text, x - nx, 1.85, z - nz, ry + Math.PI, { w, sub });
  }
  postSign('RESERVED', 'REGIONAL MANAGER', 5.4, 9.55, 0); postSign('RESERVED', 'ASST. TO THE REGIONAL MANAGER', 8.1, 9.55, 0, 0.62);
  postSign('♿ PARKING', 'PERMIT ONLY', -2.7, 9.55, 0, 0.5); postSign('♿ PARKING', 'PERMIT ONLY', 2.7, 9.55, 0, 0.5);
  postSign('VISITOR', 'DUNDER MIFFLIN', -10.8, 26.75, Math.PI);
  // curbed end islands with a tree each + light poles
  const islands = [[LOT.x0, -17.55, LOT.z0, 15.0], [17.55, LOT.x1, LOT.z0, 15.0], [LOT.x0, -17.55, 21.4, LOT.z1], [17.55, LOT.x1, 21.4, LOT.z1]];
  // HQ #101: layered canopy on lot-island trees (match the window grove)
  const tr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 7), std('#5a3e2a', 0.92), islands.length);
  const crA = new THREE.InstancedMesh(new THREE.SphereGeometry(1.1, 8, 6), M.leaf3, islands.length);
  const crB = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 7, 5), M.leaf, islands.length);
  const crC = new THREE.InstancedMesh(new THREE.SphereGeometry(0.65, 7, 5), M.leaf2, islands.length);
  const m4 = new THREE.Matrix4();
  islands.forEach(([x0, x1, z0, z1], i) => {
    box(x1 - x0, 0.16, z1 - z0, curbM, (x0 + x1) / 2, 0.06, (z0 + z1) / 2, scene, false);
    box(x1 - x0 - 0.3, 0.02, z1 - z0 - 0.3, grass, (x0 + x1) / 2, 0.145, (z0 + z1) / 2, scene, false);
    const tx = (x0 + x1) / 2, tz = (z0 + z1) / 2 + (i < 2 ? 1.2 : -1.2);
    tr.setMatrixAt(i, m4.makeTranslation(tx, 1.2, tz));
    crA.setMatrixAt(i, m4.makeTranslation(tx, 2.9, tz));
    crB.setMatrixAt(i, m4.makeTranslation(tx + 0.25, 3.2, tz - 0.1));
    crC.setMatrixAt(i, m4.makeTranslation(tx - 0.2, 3.45, tz + 0.15));
    addCollider(tx, tz, 0.4, 0.4);
    const px = tx, pz = (z0 + z1) / 2 + (i < 2 ? -1.2 : 1.2);
    box(0.14, 6.5, 0.14, M.steel, px, 3.25, pz, scene, false); box(0.9, 0.14, 0.35, M.steel, px + (px < 0 ? 0.4 : -0.4), 6.45, pz, scene, false);
    box(0.6, 0.03, 0.25, M.light, px + (px < 0 ? 0.55 : -0.55), 6.37, pz, scene, false); addCollider(px, pz, 0.25, 0.25);
  });
  tr.castShadow = crA.castShadow = crB.castShadow = true; scene.add(tr, crA, crB, crC);
  // grass strips along the building front past the sidewalk: low shrubs (instanced)
  { const spots = []; for (let x = 11.9; x < 20; x += 1.3) if (Math.abs(x - 16.5) > 2.1) spots.push([x, 8.7]);
    for (let z = -15.0; z < 7.0; z += 1.4) spots.push([12.0, z]);   // HQ #81: along the building's east face (pre-shift z)
    const sh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.48, 6, 5), M.leaf2, spots.length);
    spots.forEach(([x, z], i) => { m4.makeScale(1.15 + Math.random() * 0.3, 0.7 + Math.random() * 0.25, 1.0).setPosition(x, 0.3, z); sh.setMatrixAt(i, m4); }); sh.castShadow = true; scene.add(sh);
    for (const [x, z] of spots) addCollider(x, z, 0.9, 0.8); }
  // SCRANTON BUSINESS PARK monument sign by the entrance drive
  { const bx = 16.5, bz = 8.7; box(3.2, 0.5, 0.6, std('#8c6b52', 0.9), bx, 0.25, bz); box(2.9, 1.0, 0.4, std('#3d4a3a', 0.8), bx, 1.0, bz);
    sign('SCRANTON BUSINESS PARK', bx, 1.1, bz + 0.205, 0, { w: 2.7, h: 0.75, bg: '#3d4a3a', fg: '#f3ead6', sub: '1725 SLOUGH AVENUE · SCRANTON, PA', font: 'Georgia,serif', weight: 700 });
    addCollider(bx, bz, 3.2, 0.6); }
  // cars: extruded side profile (body) + tinted greenhouse + roof; wheels for every car in one instanced mesh
  const carGeo = new Map(), wheelSpots = [], TRUCK = { x: -15.9, z: 13.95 - DZ };
  function profileGeo(pts, width, bevel = 0.04) {
    const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]);
    const g = new THREE.ExtrudeGeometry(s, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -(width - 2 * bevel) / 2); g.rotateY(-Math.PI / 2); return g; // profile u -> world z (front = -z)
  }
  function carGeos(kind) {
    if (carGeo.has(kind)) return carGeo.get(kind);
    const K = { sedan: { L: 4.6, W: 1.8, belt: 0.92, roof: 1.42, hood: 1.0, deck: 0.9 }, coupe: { L: 4.7, W: 1.85, belt: 0.86, roof: 1.28, hood: 1.25, deck: 0.8 },
      suv: { L: 4.8, W: 1.95, belt: 1.08, roof: 1.78, hood: 0.95, deck: 0.35 } }[kind];
    const h = K.L / 2;
    const body = profileGeo([[-h, 0.3], [-h, 0.72], [-h + 0.15, 0.8], [-h + K.hood, K.belt], [h - K.deck, K.belt], [h - 0.1, K.belt - 0.04], [h, 0.7], [h, 0.3]], K.W);
    const a = -h + K.hood, b = h - K.deck, rf = K.roof;
    const glass = profileGeo([[a - 0.02, K.belt - 0.02], [a + 0.55, rf - 0.04], [b - 0.45, rf - 0.04], [b + 0.05, K.belt - 0.02]], K.W - 0.16, 0.02);
    const roof = profileGeo([[a + 0.5, rf - 0.06], [a + 0.6, rf], [b - 0.5, rf], [b - 0.4, rf - 0.06]], K.W - 0.18, 0.03);
    const r = { body, glass, roof, K }; carGeo.set(kind, r); return r;
  }
  const glassC = std('#25323d', 0.12, 0.5), lightF = std('#fff6cc', 0.3, 0, { emissive: '#fff2b0', emissiveIntensity: 0.35 }), lightR = std('#a31515', 0.4);
  function car(x, z, ry, color, kind = 'sedan') {
    const { body, glass, roof, K } = carGeos(kind), g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const pm = std(color, 0.32, 0.5);
    for (const [geo, mat] of [[body, pm], [glass, glassC], [roof, pm]]) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); }
    for (const sx of [-1, 1]) { box(0.36, 0.1, 0.03, lightF, sx * (K.W / 2 - 0.3), 0.66, -K.L / 2 - 0.01, g, false); box(0.36, 0.1, 0.03, lightR, sx * (K.W / 2 - 0.3), 0.66, K.L / 2 + 0.01, g, false); }
    box(K.W - 0.1, 0.16, 0.06, std('#2a2a2a', 0.7), 0, 0.38, -K.L / 2 - 0.02, g, false); box(K.W - 0.1, 0.16, 0.06, std('#2a2a2a', 0.7), 0, 0.38, K.L / 2 + 0.02, g, false); // bumpers
    for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) wheelSpots.push(new THREE.Vector3(wx * (K.W / 2 - 0.04), 0.34, wz * (K.L / 2 - 0.85)).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry).add(new THREE.Vector3(x, 0, z)));
    addCollider(x, z, K.W + 0.1, K.L + 0.1, ry);
  }
  car(5.4, 12.6, 0, '#b7bcc2', 'coupe');      // Michael's silver Sebring (RESERVED · REGIONAL MANAGER)
  car(8.1, 12.6, 0, '#7b1e1e', 'coupe');      // Dwight's Trans Am (RESERVED · ASST. TO THE R.M.)
  car(-5.4, 12.6, 0, '#2f4f7a');              // Jim's
  car(13.5, 12.6, 0, '#d8d2c2');              // Pam's
  car(-8.1, 23.8, Math.PI, '#355e3b', 'suv'); // Stanley's
  car(2.7, 23.8, Math.PI, '#e8d7a0');         // Angela's
  car(10.8, 23.8, Math.PI, '#5a5f66', 'suv'); // Kevin's
  { const wheel = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateZ(Math.PI / 2), std('#151515', 0.9), wheelSpots.length + 6), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    // car wheels follow each car's heading (cars here are all axis-aligned, so the base rotation is enough)
    wheelSpots.forEach((p, i) => wheel.setMatrixAt(i, m4.compose(p, q, one)));
    // the box truck's six wheels (truck below is parked along x, so wheels turn 90 degrees)
    const tq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), big = new THREE.Vector3(1.25, 1.25, 1);
    // HQ #81: truck is backed up to the warehouse dock now (cab toward the lot), so its wheels run along z
    [[2.3, -1.05], [2.3, 1.05], [-2.2, -1.05], [-2.2, 1.05], [-2.9, -1.05], [-2.9, 1.05]].forEach(([u, v], i) => wheel.setMatrixAt(wheelSpots.length + i, m4.compose(new THREE.Vector3(TRUCK.x + v, 0.42, TRUCK.z + u), q, big)));
    wheel.castShadow = true; scene.add(wheel); }
  // Dunder Mifflin box truck, backed up to the warehouse loading dock (HQ #81)
  { const tx = TRUCK.x, tz = TRUCK.z, g = new THREE.Group(); g.position.set(tx, 0, tz); g.rotation.y = 0; scene.add(g);
    const white = std('#f1f1ee', 0.6), cabM = std('#e9e9e4', 0.5, 0.3);
    // HQ #84: cargo box is a hollow shell now (floor 0.75, roof 3.25, z -3.7..1.3) with a roll-up rear door, so you can walk in off Dock 1
    { const inner = std('#d9d6cf', 0.8), fl = std('#6b5a45', 0.85);
      box(2.4, 0.05, 5.0, fl, 0, 0.725, -1.2, g, false); box(2.4, 0.06, 5.0, white, 0, 3.22, -1.2, g, false);
      for (const sx of [-1, 1]) { box(0.05, 2.5, 5.0, white, sx * 1.175, 2.0, -1.2, g); box(0.01, 2.4, 4.9, inner, sx * 1.145, 2.0, -1.2, g, false); }
      box(2.4, 2.5, 0.05, white, 0, 2.0, 1.275, g, false);
      for (const sx of [-1, 1]) box(0.14, 2.5, 0.08, std('#bdbdb8', 0.5, 0.4), sx * 1.13, 2.0, -3.66, g, false);   // rear door posts
      box(2.4, 0.24, 0.08, std('#bdbdb8', 0.5, 0.4), 0, 3.1, -3.66, g, false); box(2.4, 0.1, 0.12, std('#222', 0.8), 0, 0.72, -3.66, g, false);
      const tdt = canvasTex(64, 256, (c, w, h) => { c.fillStyle = '#ecebe6'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 20) { c.fillStyle = '#c9c8c2'; c.fillRect(0, y, w, 3); } });
      const td = new THREE.Mesh(new THREE.BoxGeometry(2.12, 2.24, 0.04), std('#ffffff', 0.55, 0.3, { map: tdt })); td.position.set(0, 0.78 + 1.12, -3.66); g.add(td); BAY.truckDoor = td;
      // a load of paper on pallets up by the cab
      const pt = paperTex.clone(); pt.wrapS = pt.wrapT = THREE.RepeatWrapping; pt.repeat.set(2, 2); pt.needsUpdate = true; const pl2 = std('#ffffff', 0.85, 0, { map: pt });
      for (const sx of [-0.55, 0.55]) { box(1.0, 0.12, 1.1, M.pallet, sx, 0.81, 0.55, g, false); box(0.92, 1.0, 1.0, pl2, sx, 1.37, 0.55, g, false); }
      box(0.9, 0.12, 1.0, M.pallet, -0.55, 0.81, -0.7, g, false); box(0.82, 0.7, 0.9, pl2, -0.55, 1.22, -0.7, g, false);
      const tl = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ color: '#fff6dc' })); tl.rotation.x = Math.PI / 2; tl.position.set(0, 3.18, -1.2); g.add(tl); }
    box(2.3, 1.7, 1.8, cabM, 0, 1.55, 2.3, g); box(2.2, 0.7, 0.05, glassC, 0, 1.95, 3.21, g, false);
    box(2.4, 0.3, 6.8, std('#2a2a2a', 0.8), 0, 0.6, 0, g);
    const lt = canvasTex(512, 160, (c, w, h) => { c.fillStyle = '#f1f1ee'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d1d1d'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = '800 70px Oswald,"Arial Narrow",Arial'; c.fillText('DUNDER MIFFLIN', w / 2, h * 0.42); c.font = '600 30px Arial'; c.fillText('PAPER COMPANY · SCRANTON, PA', w / 2, h * 0.78); });
    for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.44), new THREE.MeshBasicMaterial({ map: lt, toneMapped: false })); m.position.set(sx * 1.21, 2.1, -1.2); m.rotation.y = sx * Math.PI / 2; g.add(m); }
    // HQ #84: walls of the cargo box + the cab/pallets (the inside is walkable at truck level)
    colliders.push({ minX: tx - 1.25, maxX: tx - 1.12, minZ: tz - 3.75, maxZ: tz + 1.3 }, { minX: tx + 1.12, maxX: tx + 1.25, minZ: tz - 3.75, maxZ: tz + 1.3 },
      { minX: tx - 1.25, maxX: tx + 1.25, minZ: tz - 0.15, maxZ: tz + 3.45 }, { minX: tx - 1.25, maxX: tx - 0.08, minZ: tz - 1.25, maxZ: tz - 0.15 }); }
  // a green dumpster by the stairwell (every office park has one)
  { const dx = -26.0, dz = 3.4; /* HQ #84: slid west, out of Dock 2's door */ box(1.9, 1.2, 1.2, std('#2f5d3a', 0.6, 0.3), dx, 0.6, dz); box(2.0, 0.08, 1.3, std('#24472c', 0.6), dx, 1.24, dz, scene, false); addCollider(dx, dz, 2.0, 1.3); }
  for (const o of scene.children.slice(n0)) OUTSIDE.add(o);
  OUTSIDE.position.set(0, BY, DZ);
  for (const c of colliders.splice(c0)) { c.minZ += DZ; c.maxZ += DZ; BCOL.push(c); } // the lot is ground level: its colliders go to the ground set
}

// ---------- HQ #81: the building. Dunder Mifflin is one tenant on the 2nd floor of a 3-story brick office building ----------
// Like the show: you park in the lot, walk through the building's own front doors into a shared ground-floor lobby, ride the
// elevator (or take the stairwell) up to 2, and come out in a hallway with Dunder Mifflin's doors on one side and Vance
// Refrigeration across the hall (restrooms down the hall too). The warehouse is the ground floor of the west wing: the old
// stairs by the water cooler still go down to it, and a steel door connects it to the lobby.
// Floors: level 0 = 2nd floor (y 0, DM + hallway), level -1 = ground floor (y BY = -4.4: lobby, warehouse, lot). Floor 3 is
// facade only. iPad: only the floor you're on (plus the stair/elevator core you're in) is drawn; see updateFloors().
const SB = 10.1;                                                     // hallway | south block line (Vance, elevator, stairs, restrooms)
const BLD = { x0: -11.12, x1: 11.12, z0: -7.62, z1: 15.62, top: BY + 14 }; // east wing outer faces (3 floors + parapet)
const ELEV = { x0: 3.0, x1: 5.0, z1: 12.3, door: [3.4, 4.6], y: 0, at: 0, open: 0, want: 0, hold: 0, state: 'idle', t: 0, dwell: 0, armed: true, rider: false, from: 0, to: 0, shown: null };
const MST = { x0: 5.5, x1: 8.1, xm: 6.8, zn: 10.17, za: 11.4, zb: 14.2, zs: 15.4 }; // main stairwell: inner box, flights run za..zb
const LDOOR = { open: 0, panels: [], col: { minX: -0.9, maxX: 0.9, minZ: 15.42, maxZ: 15.58 } };
const EXT = new THREE.Group(), LOBBY = new THREE.Group(), CORE = new THREE.Group(), ELEVCAR = new THREE.Group();
LOBBY.position.y = BY; scene.add(EXT, LOBBY, CORE, ELEVCAR);
const inCar = (x, z) => x > ELEV.x0 + 0.08 && x < ELEV.x1 - 0.08 && z > SB + 0.1 && z < ELEV.z1;
const inCore = (x, z) => x > MST.x0 - 0.05 && x < MST.x1 + 0.05 && z > MST.zn - 0.15 && z < MST.zs + 0.05;
// main stairwell height + level: east half = top landing + flight A (2nd floor side), mid landing, west half = flight B + bottom landing
function coreY(x, z) {
  const east = x > MST.xm;
  if (z >= MST.zb) return [BY / 2, -1];
  if (z <= MST.za) return east ? [0, 0] : [BY, -1];
  const f = (z - MST.za) / (MST.zb - MST.za);
  return east ? [BY / 2 * f, 0] : [BY / 2 + BY / 2 * (1 - f), -1];
}
// solid box by its extents; a wall run with door gaps that also pushes colliders into `set`
function slab(x0, x1, y0, y1, z0, z1, mat, parent = scene) { return box(x1 - x0, y1 - y0, z1 - z0, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, parent, false); }
function runWall(set, ax, az, bx, bz, { gaps = [], h = 3.0, head = 2.25, mat = M.wall, t = 0.14, y0 = 0, frame = M.walnut } = {}) {
  const alongX = az === bz, a0 = alongX ? Math.min(ax, bx) : Math.min(az, bz), a1 = alongX ? Math.max(ax, bx) : Math.max(az, bz), f = alongX ? az : ax;
  const put = (s0, s1, yy0, yy1, m = mat) => alongX ? slab(s0, s1, y0 + yy0, y0 + yy1, f - t / 2, f + t / 2, m) : slab(f - t / 2, f + t / 2, y0 + yy0, y0 + yy1, s0, s1, m);
  let cur = a0;
  for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (g0 > cur) { put(cur, g0, 0, h); if (set) set.push(alongX ? { minX: cur, maxX: g0, minZ: f - t / 2 - 0.02, maxZ: f + t / 2 + 0.02 } : { minX: f - t / 2 - 0.02, maxX: f + t / 2 + 0.02, minZ: cur, maxZ: g0 }); }
    put(g0, g1, head, h); if (frame) for (const a of [g0, g1]) alongX ? slab(a - 0.04, a + 0.04, y0, y0 + head, f - t / 2 - 0.02, f + t / 2 + 0.02, frame) : slab(f - t / 2 - 0.02, f + t / 2 + 0.02, y0, y0 + head, a - 0.04, a + 0.04, frame);
    cur = g1; }
  if (cur < a1) { put(cur, a1, 0, h); if (set) set.push(alongX ? { minX: cur, maxX: a1, minZ: f - t / 2 - 0.02, maxZ: f + t / 2 + 0.02 } : { minX: f - t / 2 - 0.02, maxX: f + t / 2 + 0.02, minZ: cur, maxZ: a1 }); }
}
const block2 = (set, x0, x1, z0, z1) => set.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });   // solid, non-walkable space (other tenants)
const flatPlane = (w, d, mat, x, y, z, down = false, parent = scene) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = down ? Math.PI / 2 : -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = !down; parent.add(m); return m; };
function ceilLights(spots, y, parent = scene) {
  const lp = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2, 0.6), M.light, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
  spots.forEach(([x, z], i) => lp.setMatrixAt(i, m4.compose(new THREE.Vector3(x, y, z), q, one))); parent.add(lp); return lp;
}
// a closed office door (wood leaf + frame + plate) on a wall plane; ry faces the side it's seen from
function closedDoor(x, z, ry, label, sub = '', { w = 0.92, y0 = 0, wood = '#8a6a4a' } = {}) {
  const g = new THREE.Group(); g.position.set(x, y0, z); g.rotation.y = ry; scene.add(g);
  box(w + 0.12, 2.2, 0.06, M.walnut, 0, 1.1, 0.0, g, false); box(w, 2.12, 0.06, std(wood, 0.6), 0, 1.06, 0.02, g, false);
  box(0.04, 0.04, 0.12, std('#c9cdd2', 0.25, 0.9), w / 2 - 0.12, 1.02, 0.07, g, false);
  if (label) { const pl = plate(label, 0, 0, 0, 0, { w: 0.62, sub }); scene.remove(pl); pl.position.set(-w / 2 - 0.42, 1.55, 0.05); g.add(pl); }
  return g;
}

// ===== 2nd floor (level 0): hallway outside DM, Vance Refrigeration across the hall, elevator, stairwell door, restrooms =====
{
  const hallCarpet = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#8a8170'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 100 + Math.random() * 60; g.fillStyle = `rgba(${v},${v - 8},${v - 22},.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(70,60,45,.25)'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 4); } }, [11, 1.3]);
  const hallFloor = std('#ffffff', 0.95, 0, { map: hallCarpet });
  flatPlane(22, SB - Z1 + 0.04, hallFloor, 0, 0.002, (Z1 + SB) / 2);
  flatPlane(22, SB - Z1, M.ceiling, 0, H, (Z1 + SB) / 2, true);
  ceilLights([-9, -6, -3, 0, 3, 6, 9].map(x => [x, (Z1 + SB) / 2]), H - 0.01);
  // base trim along the DM side
  slab(X0, X1, 0, 0.1, Z1 + 0.1, Z1 + 0.12, std('#5a4a3a', 0.7));
  // hallway end walls: west = a closed suite door, east = a window onto the grass
  runWall(colliders, X0, Z1, X0, SB + 0.07, { t: 0.2 });
  closedDoor(X0 + 0.11, (Z1 + SB) / 2 + 0.2, Math.PI / 2, 'SUITE 210', 'AVAILABLE FOR LEASE');
  slab(X1 - 0.1, X1 + 0.1, 0, 0.9, Z1, SB + 0.07, M.wall); slab(X1 - 0.1, X1 + 0.1, 2.5, H, Z1, SB + 0.07, M.wall);
  { const gl = slab(X1 - 0.02, X1 + 0.02, 0.9, 2.5, Z1 + 0.1, SB - 0.03, M.glass); gl.renderOrder = 2; for (const z of [Z1 + 0.12, (Z1 + SB) / 2, SB - 0.05]) slab(X1 - 0.05, X1 + 0.05, 0.9, 2.5, z - 0.03, z + 0.03, M.mullion); }
  block2(colliders, X1 - 0.1, X1 + 0.6, Z1, SB + 0.1);
  // DM's door from the hallway side: company sign over the doors + suite plate
  pngSign('dunder-mifflin', 0, 2.7, Z1 + 0.115, 0, 1.4);
  plate('DUNDER MIFFLIN', 1.45, 1.6, Z1 + 0.115, 0, { w: 0.62, sub: 'SUITE 200 · PAPER COMPANY, INC.' });
  // ---- Vance Refrigeration (suite 201): glass storefront + glass door right across from DM's doors, a lit reception behind
  const VX0 = -2.6, VX1 = 2.0, VZ = 13.0;
  runWall(null, X0, SB, VX0, SB, {}); runWall(null, VX1, SB, ELEV.x0 - 0.2, SB, {});
  for (const [a, b] of [[VX0, -0.62], [0.62, VX1]]) { const gl = slab(a, b, 0.08, 2.4, SB - 0.02, SB + 0.02, M.glass); gl.renderOrder = 2; }
  slab(VX0, VX1, 0, 0.08, SB - 0.07, SB + 0.07, M.mullion); slab(VX0, VX1, 2.4, H, SB - 0.07, SB + 0.07, M.wall);
  for (const x of [VX0, -1.6, -0.62, 0.62, VX1]) slab(x - 0.03, x + 0.03, 0, 2.4, SB - 0.06, SB + 0.06, M.mullion);
  { const gl = slab(-0.6, 0.6, 0.05, 2.25, SB - 0.015, SB + 0.015, std('#bcd7e6', 0.05, 0.2, { transparent: true, opacity: 0.32, depthWrite: false })); gl.renderOrder = 2;
    slab(-0.62, 0.62, 2.25, 2.4, SB - 0.05, SB + 0.05, M.mullion); slab(-0.04, 0.04, 0.05, 2.25, SB - 0.05, SB + 0.05, M.mullion);
    for (const sx of [-1, 1]) slab(sx * 0.1 - 0.012, sx * 0.1 + 0.012, 0.7, 1.4, SB - 0.11, SB - 0.06, std('#c9cdd2', 0.25, 0.9)); }
  const vanceLogo = canvasTex(512, 160, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#0d4c92'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#0d4c92'; g.font = '800 64px "Arial Black",Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('VANCE', w / 2 + 34, 62);
    g.font = '700 30px Arial'; g.fillText('REFRIGERATION', w / 2 + 34, 112); g.fillStyle = '#5ab0ff'; g.font = '700 86px Arial'; g.fillText('❄', 66, h / 2 + 4); });
  const vanceGlass = canvasTex(256, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.95)'; g.textAlign = 'center'; g.font = '800 34px Arial'; g.fillText('VANCE', w / 2, 46); g.font = '700 18px Arial'; g.fillText('REFRIGERATION', w / 2, 74); g.font = '600 13px Arial'; g.fillText('SUITE 201 · PLEASE COME IN', w / 2, 102); });
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), new THREE.MeshBasicMaterial({ map: vanceGlass, transparent: true, depthWrite: false, toneMapped: false })); m.position.set(-1.1, 1.5, SB - 0.03); m.rotation.y = Math.PI; scene.add(m); }
  plate('VANCE REFRIGERATION', VX1 + 0.42, 1.6, SB - 0.075, Math.PI, { w: 0.62, sub: 'SUITE 201 · BOB VANCE, PRESIDENT' });
  // inside Vance: carpet, side walls, logo wall, reception desk, a glass-door display cooler, plant, lights
  flatPlane(VX1 - VX0 + 1.6, VZ - SB, std('#6d7d8c', 0.95), (VX0 + VX1) / 2, 0.003, (SB + VZ) / 2);
  flatPlane(VX1 - VX0 + 1.6, VZ - SB, M.ceiling, (VX0 + VX1) / 2, H, (SB + VZ) / 2, true);
  ceilLights([[-1.4, 11.5], [1.0, 11.5]], H - 0.01);
  const vWall = std('#e6eef5', 0.9);
  slab(VX0 - 0.8, VX1 + 0.8, 0, H, VZ, VZ + 0.12, vWall); slab(VX0 - 0.92, VX0 - 0.8, 0, H, SB, VZ, vWall); slab(VX1 + 0.8, VX1 + 0.92, 0, H, SB, VZ, vWall);
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshBasicMaterial({ map: vanceLogo, toneMapped: false })); m.position.set(-0.3, 1.95, VZ - 0.01); m.rotation.y = Math.PI; scene.add(m); }
  slab(-1.3, 0.7, 0, 1.05, 11.7, 12.2, std('#2c4f7a', 0.6)); slab(-1.4, 0.8, 1.05, 1.1, 11.65, 12.25, std('#d9dde2', 0.4, 0.2)); // reception desk
  box(0.4, 0.28, 0.04, M.bezel, -0.6, 1.25, 11.95, scene, false);
  { const cz = 12.5, cx = 1.7; slab(cx - 0.4, cx + 0.4, 0, 1.95, cz - 0.3, cz + 0.3, std('#e9ecef', 0.4, 0.3)); const gl = slab(cx - 0.34, cx + 0.34, 0.15, 1.8, cz - 0.32, cz - 0.3, M.vendGlass);
    for (let y = 0.5; y < 1.8; y += 0.4) slab(cx - 0.3, cx + 0.3, y, y + 0.02, cz - 0.25, cz + 0.2, std('#cfd6de', 0.3, 0.6));
    for (let i = 0; i < 9; i++) box(0.07, 0.2, 0.07, std(['#c62828', '#1565c0', '#2e7d32'][i % 3], 0.5), cx - 0.24 + (i % 3) * 0.24, 0.62 + Math.floor(i / 3) * 0.4, cz - 0.05, scene, false); }
  plant(-2.3, 12.5, 0.9); colliders.pop();
  // the rest of Vance's suite is walled off: one solid collider behind the storefront
  block2(colliders, X0, ELEV.x0 - 0.2, SB - 0.09, BLD.z1);
  // ---- restrooms down the hall (the show's DM bathrooms are out in the hallway)
  runWall(colliders, 8.2, SB, X1, SB, {});
  closedDoor(8.9, SB - 0.075, Math.PI, 'MEN', '', { w: 0.86 }); closedDoor(10.25, SB - 0.075, Math.PI, 'WOMEN', '', { w: 0.86 });
  block2(colliders, 8.2, X1 + 0.2, SB - 0.09, BLD.z1);
  // fire extinguisher cabinet + hallway directory by the elevator
  slab(-5.1, -4.8, 1.0, 1.55, SB - 0.1, SB - 0.07, std('#c62828', 0.5));
  plate('2 · SECOND FLOOR', 2.55, 1.6, SB - 0.075, Math.PI, { w: 0.5, sub: '200 DUNDER MIFFLIN · 201 VANCE' });
}

// ===== elevator: car (moves between floors), hall doors on both floors, front walls, floor indicator =====
const ELEVTEX = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 64; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, t }; })();
function drawElevIndicator(label) {
  const g = ELEVTEX.c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#ff5a36'; g.font = '700 44px "Courier New",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 64, 34); ELEVTEX.t.needsUpdate = true;
}
drawElevIndicator('2');
const elevDoors = { hall0: [], hallG: [], car: [] };
{
  const steel = std('#c3c8ce', 0.35, 0.35), steelDk = std('#8a9097', 0.4, 0.35), indM = new THREE.MeshBasicMaterial({ map: ELEVTEX.t, toneMapped: false });
  const [d0, d1] = ELEV.door, dc = (d0 + d1) / 2, pw = (d1 - d0) / 2 + 0.02;
  // front walls of the shaft (one piece spans both floors) + steel frames + indicators + call buttons on each floor
  for (const [a, b] of [[ELEV.x0 - 0.2, d0], [d1, MST.x0 - 0.1]]) slab(a, b, BY, H, SB - 0.07, SB + 0.07, M.wall, CORE);
  slab(d0, d1, BY + 2.2, 0, SB - 0.07, SB + 0.07, M.wall, CORE); slab(d0, d1, 2.2, H, SB - 0.07, SB + 0.07, M.wall, CORE);
  for (const y0 of [0, BY]) {
    for (const x of [d0 - 0.05, d1 + 0.05]) slab(x - 0.05, x + 0.05, y0, y0 + 2.25, SB - 0.1, SB + 0.1, steelDk, CORE);
    slab(d0 - 0.1, d1 + 0.1, y0 + 2.2, y0 + 2.3, SB - 0.1, SB + 0.1, steelDk, CORE);
    const ind = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), indM); ind.position.set(dc, y0 + 2.48, SB - 0.075); ind.rotation.y = Math.PI; CORE.add(ind);
    slab(d1 + 0.22, d1 + 0.34, y0 + 1.0, y0 + 1.3, SB - 0.09, SB - 0.07, steel, CORE);
    for (const yy of [1.1, 1.2]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), new THREE.MeshBasicMaterial({ color: '#ffe9a8' })); b.position.set(d1 + 0.28, y0 + yy, SB - 0.095); b.rotation.y = Math.PI; CORE.add(b); }
  }
  // hall door panels: 2nd floor in the office scene, ground floor in the lobby
  for (const [set, y0, parent] of [[elevDoors.hall0, 0, scene], [elevDoors.hallG, 0, LOBBY]]) for (const sx of [-1, 1]) {
    const m = slab(-pw / 2, pw / 2, y0, y0 + 2.18, -0.02, 0.02, steel, parent); m.position.x = dc + sx * pw / 2; m.position.z = SB - 0.02; set.push({ m, sx, x: dc + sx * pw / 2 });
  }
  // the car: floor, walls, ceiling light, handrail, button panel, car doors (moves with ELEV.y)
  const cw = ELEV.x1 - ELEV.x0 - 0.1, cd = ELEV.z1 - SB - 0.12, cz0 = SB + 0.08, ccx = (ELEV.x0 + ELEV.x1) / 2, wood = std('#7a5534', 0.6);
  slab(ELEV.x0 + 0.05, ELEV.x1 - 0.05, -0.1, 0.004, cz0, cz0 + cd, std('#3a3a3a', 0.9), ELEVCAR);
  slab(ELEV.x0 + 0.05, ELEV.x1 - 0.05, 2.45, 2.55, cz0, cz0 + cd, steelDk, ELEVCAR);
  { const l = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.5, cd - 0.6), M.light); l.rotation.x = Math.PI / 2; l.position.set(ccx, 2.44, cz0 + cd / 2); ELEVCAR.add(l); }
  slab(ELEV.x0, ELEV.x0 + 0.06, 0, 2.5, cz0, cz0 + cd, wood, ELEVCAR); slab(ELEV.x1 - 0.06, ELEV.x1, 0, 2.5, cz0, cz0 + cd, wood, ELEVCAR);
  slab(ELEV.x0, ELEV.x1, 0, 2.5, cz0 + cd, cz0 + cd + 0.06, wood, ELEVCAR);
  for (const [a, b] of [[ELEV.x0, d0], [d1, ELEV.x1]]) slab(a, b, 0, 2.5, cz0, cz0 + 0.06, steel, ELEVCAR);
  slab(d0, d1, 2.2, 2.5, cz0, cz0 + 0.06, steel, ELEVCAR);
  slab(ELEV.x0 + 0.1, ELEV.x1 - 0.1, 0.9, 0.94, cz0 + cd - 0.07, cz0 + cd - 0.03, steel, ELEVCAR);                    // handrail
  slab(ELEV.x1 - 0.08, ELEV.x1 - 0.06, 0.9, 1.5, cz0 + 0.2, cz0 + 0.5, steel, ELEVCAR);                            // button panel
  const btn = canvasTex(64, 160, (g, w, h) => { g.fillStyle = '#9aa1a8'; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 22px Arial';
    for (const [i, t] of [['3', 0], ['2', 1], ['1', 2]].map(([t, i]) => [i, t])) { g.fillStyle = '#ddd'; g.beginPath(); g.arc(32, 30 + i * 46, 16, 0, 7); g.fill(); g.fillStyle = '#222'; g.fillText(t, 32, 31 + i * 46); } });
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.55), new THREE.MeshBasicMaterial({ map: btn, toneMapped: false })); m.position.set(ELEV.x1 - 0.085, 1.2, cz0 + 0.35); m.rotation.y = -Math.PI / 2; ELEVCAR.add(m); }
  { const ind = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), indM); ind.position.set(dc, 2.33, cz0 + 0.07); ELEVCAR.add(ind); }
  for (const sx of [-1, 1]) { const m = slab(-pw / 2, pw / 2, 0, 2.18, -0.015, 0.015, steel, ELEVCAR); m.position.x = dc + sx * pw / 2; m.position.z = cz0 + 0.1; elevDoors.car.push({ m, sx, x: dc + sx * pw / 2 }); }
  // colliders: shaft side/back walls on both floors + a door collider per floor (dropped while that floor's doors are open)
  for (const set of [colliders, BCOL]) set.push({ minX: ELEV.x0 - 0.05, maxX: ELEV.x0 + 0.08, minZ: SB, maxZ: ELEV.z1 }, { minX: ELEV.x1 - 0.08, maxX: MST.x0 - 0.1, minZ: SB, maxZ: ELEV.z1 },
    { minX: ELEV.x0, maxX: ELEV.x1, minZ: ELEV.z1 - 0.1, maxZ: ELEV.z1 + 0.1 }, { minX: ELEV.x0 - 0.2, maxX: d0, minZ: SB - 0.09, maxZ: SB + 0.09 }, { minX: d1, maxX: MST.x0 - 0.1, minZ: SB - 0.09, maxZ: SB + 0.09 });
  ELEV.col0 = { minX: d0, maxX: d1, minZ: SB - 0.09, maxZ: SB + 0.09 }; ELEV.colG = { ...ELEV.col0 };
  colliders.push(ELEV.col0); BCOL.push(ELEV.colG);
  block2(colliders, ELEV.x0 - 0.2, MST.x0 - 0.1, ELEV.z1, BLD.z1); block2(BCOL, ELEV.x0 - 0.2, MST.x0 - 0.1, ELEV.z1, BLD.z1);
}

// ===== main stairwell (2nd floor <-> lobby): enclosed switchback, top landing + flight A east, flight B + bottom landing west =====
{
  const block = std('#d8d2c4', 0.92), tread = std('#7c7f84', 0.8), nose = new THREE.MeshBasicMaterial({ color: '#e8c21c' }), rail = std('#3b3f45', 0.45, 0.6), land = std('#a9a49a', 0.85);
  const { x0, x1, xm, zn, za, zb, zs } = MST, N = 11, run = (zb - za) / N, rise = -BY / 2 / N;
  // walls (inner faces), BY .. H
  slab(x0 - 0.1, x0, BY, H, SB, zs + 0.1, block, CORE); slab(x1, x1 + 0.1, BY, H, SB, zs + 0.1, block, CORE); slab(x0, x1, BY, H, zs, zs + 0.1, block, CORE);
  slab(xm - 0.05, xm + 0.05, BY, H, zn, zb, block, CORE);                                                   // divider between the flights
  // north wall: ground-floor door (west half, x 5.6..6.7) and 2nd-floor door (east half, x 6.95..8.05)
  const N0 = [5.6, 6.7], N1 = [6.95, 8.05];
  slab(x0 - 0.1, N0[0], BY, H, SB - 0.07, SB + 0.07, block, CORE); slab(N0[1], xm, BY, H, SB - 0.07, SB + 0.07, block, CORE); slab(N0[0], N0[1], BY + 2.2, H, SB - 0.07, SB + 0.07, block, CORE);
  slab(xm, N1[0], BY, H, SB - 0.07, SB + 0.07, block, CORE); slab(N1[1], x1 + 0.1, BY, H, SB - 0.07, SB + 0.07, block, CORE); slab(N1[0], N1[1], BY, 0, SB - 0.07, SB + 0.07, block, CORE); slab(N1[0], N1[1], 2.2, H, SB - 0.07, SB + 0.07, block, CORE);
  for (const [[a, b], y0] of [[N0, BY], [N1, 0]]) for (const x of [a, b]) slab(x - 0.04, x + 0.04, y0, y0 + 2.2, SB - 0.09, SB + 0.09, std('#5c6168', 0.6, 0.3), CORE);
  { const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, zs - zn), M.ceiling); c.rotation.x = Math.PI / 2; c.position.set((x0 + x1) / 2, H, (zn + zs) / 2); CORE.add(c); }
  // landings + steps (solid blocks)
  slab(xm + 0.05, x1, BY, 0, zn, za, land, CORE);                 // top landing (2nd floor)
  slab(x0, x1, BY, BY / 2, zb, zs, land, CORE);                   // mid landing
  slab(x0, xm - 0.05, BY - 0.01, BY + 0.005, zn, za, land, CORE); // bottom landing (ground)
  for (let i = 0; i < N; i++) {
    const tyA = -(i + 1) * rise, zA = za + i * run;               // flight A: down toward the south
    slab(xm + 0.05, x1, BY, tyA, zA, zA + run, tread, CORE); slab(xm + 0.05, x1, tyA, tyA + 0.012, zA + run - 0.05, zA + run, nose, CORE);
    const tyB = BY / 2 - (i + 1) * rise, zB = zb - (i + 1) * run; // flight B: down toward the north
    if (tyB > BY + 0.01) { slab(x0, xm - 0.05, BY, tyB, zB, zB + run, tread, CORE); slab(x0, xm - 0.05, tyB, tyB + 0.012, zB, zB + 0.05, nose, CORE); }
  }
  // handrails on the outer walls, sloped
  const slope = Math.atan2(-BY / 2, zb - za), rl = Math.hypot(-BY / 2, zb - za);
  { const r = box(0.05, 0.05, rl, rail, x1 - 0.06, BY / 4 + 0.92, (za + zb) / 2, CORE, false); r.rotation.x = slope; }
  { const r = box(0.05, 0.05, rl, rail, x0 + 0.06, BY * 0.75 + 0.92, (za + zb) / 2, CORE, false); r.rotation.x = -slope; }
  for (const [x, y, z] of [[(xm + x1) / 2, 2.85, (zn + za) / 2], [(x0 + x1) / 2, BY / 2 + 2.6, (zb + zs) / 2], [(x0 + xm) / 2, BY + 2.9, (zn + za) / 2]]) slab(x - 0.3, x + 0.3, y, y + 0.04, z - 0.12, z + 0.12, M.light, CORE);
  // stair signs: floor numbers + exit (the show-style plates)
  const add = m => { scene.remove(m); CORE.add(m); return m; };
  add(plate('2', (xm + x1) / 2, 1.75, zn + 0.01, 0, { w: 0.42, sub: 'DUNDER MIFFLIN · VANCE' }));
  add(plate('1', (x0 + xm) / 2, BY + 1.75, zn + 0.01, 0, { w: 0.42, sub: 'LOBBY · EXIT' }));
  add(plate('↑ 2   ↓ 1', (x0 + x1) / 2, BY / 2 + 1.7, zs - 0.01, Math.PI, { w: 0.7, sub: 'STAIR A' }));
  add(plate('STAIRS', (N1[0] + N1[1]) / 2, 2.55, SB - 0.08, Math.PI, { w: 0.62, sub: '↓ LOBBY · EXIT' }));
  add(sign('EXIT', (N1[0] + N1[1]) / 2, 2.85, SB - 0.085, Math.PI, { w: 0.4, h: 0.14, bg: '#0f5f2a', fg: '#ffffff' }));
  add(plate('STAIRS', (N0[0] + N0[1]) / 2, BY + 2.55, SB - 0.08, Math.PI, { w: 0.62, sub: '↑ 2 · DUNDER MIFFLIN' }));
  // colliders (both floors): side walls, south wall, divider; the north wall's door gap depends on the floor
  for (const set of [colliders, BCOL]) set.push({ minX: x0 - 0.15, maxX: x0, minZ: SB, maxZ: zs + 0.1 }, { minX: x1, maxX: x1 + 0.15, minZ: SB, maxZ: zs + 0.1 },
    { minX: x0, maxX: x1, minZ: zs, maxZ: zs + 0.15 }, { minX: xm - 0.06, maxX: xm + 0.06, minZ: SB, maxZ: zb });
  colliders.push({ minX: x0 - 0.1, maxX: N1[0], minZ: SB - 0.09, maxZ: SB + 0.07 }, { minX: N1[1], maxX: x1 + 0.1, minZ: SB - 0.09, maxZ: SB + 0.07 });
  BCOL.push({ minX: x0 - 0.1, maxX: N0[0], minZ: SB - 0.09, maxZ: SB + 0.07 }, { minX: N0[1], maxX: x1 + 0.1, minZ: SB - 0.09, maxZ: SB + 0.07 });
}

// ===== ground floor: the shared building lobby (built at y 0, dropped to BY in LOBBY) =====
{
  const n0 = scene.children.length, c0 = colliders.length, LH = 3.4;
  const terr = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d8d0c0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { const c = ['#b9ae98', '#efe8da', '#9d927e', '#c9bfa9'][i % 4]; g.fillStyle = c; g.fillRect(Math.random() * w, Math.random() * h, 2.5, 2.5); }
    g.strokeStyle = 'rgba(80,70,55,.35)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h); }, [1, 1]);
  terr.repeat.set(1, 1);
  const tile = (w, d) => { const t = terr.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 1.2, d / 1.2); t.needsUpdate = true; return std('#ffffff', 0.35, 0.05, { map: t }); };
  const lwall = std('#ece4d4', 0.9), wain = std('#7a5a40', 0.6);
  // floors + ceilings: hall (elevator lobby) z 7.7..10.1 and the entry z 10.1..15.45
  flatPlane(19.4, 2.4, tile(19.4, 2.4), -1.3, 0.005, 8.9); flatPlane(6.0, 5.35, tile(6, 5.35), -0.2, 0.006, 12.77);
  flatPlane(19.4, 2.4, M.ceiling, -1.3, LH, 8.9, true); flatPlane(6.0, 5.35, M.ceiling, -0.2, LH, 12.77, true);
  ceilLights([[-9, 8.9], [-6, 8.9], [-3, 8.9], [0, 8.9], [3.4, 8.9], [6.4, 8.9], [-0.2, 11.6], [-0.2, 14.2]], LH - 0.01);
  // walls + colliders (ground set)
  const W = (ax, az, bx, bz, o = {}) => runWall(colliders, ax, az, bx, bz, { h: LH, mat: lwall, ...o });
  W(-11, 7.7, 8.4, 7.7, {});                                                // north: other tenants' suites (doors below)
  W(8.4, 7.7, 8.4, SB, {}); W(8.2, SB, 8.4, SB, {});                        // east end
  W(-11, SB, -3.2, SB, {});                                                 // south-west: suite 130
  W(-3.2, SB, -3.2, 15.45, {}); W(2.8, SB, 2.8, 15.45, {});                  // entry side walls
  slab(-10.92, -10.86, 0, LH, 7.7, WH_LOBBY_DOOR[0], lwall); slab(-10.92, -10.86, 0, LH, WH_LOBBY_DOOR[1], SB, lwall); for (const z of WH_LOBBY_DOOR) slab(-10.95, -10.8, 0, 2.32, z - 0.04, z + 0.04, M.whDoor);
  slab(-10.95, -10.8, 2.3, LH, WH_LOBBY_DOOR[0], WH_LOBBY_DOOR[1], lwall);
  // wainscot rail + base along the hall
  slab(-11, 8.4, 0, 0.12, 7.77, 7.8, wain); slab(-11, 8.4, 0.95, 1.0, 7.77, 7.81, wain);
  // tenant doors (closed) + the warehouse door plate
  closedDoor(-8.2, 7.775, 0, 'SUITE 100', 'BUILDING MANAGEMENT'); closedDoor(-3.5, 7.775, 0, 'SUITE 110', 'AVAILABLE FOR LEASE'); closedDoor(4.2, 7.775, 0, 'SUITE 120', 'OFFICES');
  closedDoor(-7.0, SB - 0.075, Math.PI, 'SUITE 130', 'OFFICES');
  plate('WAREHOUSE', -10.84, 2.62, (WH_LOBBY_DOOR[0] + WH_LOBBY_DOOR[1]) / 2, Math.PI / 2, { w: 0.85, sub: 'DUNDER MIFFLIN · SHIPPING & RECEIVING' });
  // the entry: building directory, mailboxes, a bench, plants, a welcome plate, "Electric City" poster
  const dir = canvasTex(512, 640, (g, w, h) => { g.fillStyle = '#1c1a17'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b89b5e'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#e8dcc0'; g.textAlign = 'center'; g.font = '700 34px Georgia,serif'; g.fillText('SCRANTON BUSINESS PARK', w / 2, 70); g.font = '500 22px Georgia,serif'; g.fillText('1725 SLOUGH AVENUE · DIRECTORY', w / 2, 104);
    g.fillStyle = '#b89b5e'; g.fillRect(60, 124, w - 120, 3);
    const rows = [['3', 'SUITE 300', 'AVAILABLE'], ['3', 'SUITE 310', 'OFFICES'], ['2', 'DUNDER MIFFLIN PAPER CO.', '200'], ['2', 'VANCE REFRIGERATION', '201'], ['1', 'BUILDING MANAGEMENT', '100'], ['1', 'SUITE 110', 'AVAILABLE'], ['1', 'DUNDER MIFFLIN WAREHOUSE', 'WEST']];
    g.textAlign = 'left'; rows.forEach(([f, n, s], i) => { const y = 180 + i * 60; g.fillStyle = f === '2' ? '#ffffff' : '#d9ccae'; g.font = `${f === '2' ? 700 : 500} 24px Arial`; g.fillText(f, 50, y); g.fillText(n, 96, y); g.textAlign = 'right'; g.fillText(s, w - 50, y); g.textAlign = 'left'; });
    g.fillStyle = '#b89b5e'; g.font = 'italic 20px Georgia,serif'; g.textAlign = 'center'; g.fillText('Elevator + stairs at the back of the lobby', w / 2, h - 40); });
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.25), new THREE.MeshBasicMaterial({ map: dir, toneMapped: false })); m.position.set(-3.105, 1.55, 12.3); m.rotation.y = Math.PI / 2; scene.add(m);
    slab(-3.13, -3.11, 0.88, 2.22, 11.75, 12.85, std('#3b2f22', 0.5)); }
  { const mb = canvasTex(256, 192, (g, w, h) => { g.fillStyle = '#b08a4e'; g.fillRect(0, 0, w, h); for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { g.fillStyle = '#d7b878'; g.fillRect(8 + c * 41, 8 + r * 45, 36, 39); g.fillStyle = '#5a4524'; g.fillRect(36 + c * 41, 24 + r * 45, 4, 8); g.fillStyle = '#2c2416'; g.font = '700 10px Arial'; g.fillText(String(100 + r * 10 + c), 12 + c * 41, 20 + r * 45); } });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), std('#ffffff', 0.4, 0.5, { map: mb })); m.position.set(2.705, 1.3, 12.4); m.rotation.y = -Math.PI / 2; scene.add(m); slab(2.71, 2.73, 0.83, 1.77, 11.78, 13.02, std('#5a4524', 0.5)); }
  slab(-2.95, -2.55, 0, 0.45, 13.4, 14.8, std('#5c4a3d', 0.8)); block2(colliders, -3.2, -2.5, 13.35, 14.85);   // bench
  plant(2.35, 14.9, 1.0); plant(-2.8, 15.0, 1.0); plant(7.9, 8.2, 1.0); plant(-10.4, 8.2, 0.9);
  plate('WELCOME', -0.2, 2.55, 7.78, 0, { w: 1.1, sub: 'SCRANTON BUSINESS PARK · ELEVATOR + STAIRS →' });
  framed(-3.12, 1.6, 14.4, Math.PI / 2, 0.7, 0.9, (g, w, h) => { g.fillStyle = '#20324a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd54f'; g.font = '800 30px Georgia,serif'; g.textAlign = 'center'; g.fillText('SCRANTON', w / 2, h * 0.35); g.font = '600 18px Georgia,serif'; g.fillText('THE ELECTRIC CITY', w / 2, h * 0.5); g.strokeStyle = '#ffd54f'; g.lineWidth = 4; g.beginPath(); g.moveTo(w * 0.5, h * 0.6); g.lineTo(w * 0.42, h * 0.78); g.lineTo(w * 0.55, h * 0.74); g.lineTo(w * 0.47, h * 0.92); g.stroke(); });
  // storefront: glass + mullions + automatic sliding doors (x -0.9..0.9)
  const alu = std('#2b2e33', 0.35, 0.7), sfGlass = new THREE.MeshStandardMaterial({ color: '#bcd7e6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false });
  for (const [a, b] of [[-3.2, -0.95], [0.95, 2.8]]) { const gl = slab(a, b, 0.1, LH - 0.2, 15.48, 15.52, sfGlass); gl.renderOrder = 2; }
  for (const x of [-3.2, -2.05, -0.95, 0.95, 1.9, 2.8]) slab(x - 0.04, x + 0.04, 0, LH, 15.44, 15.56, alu);
  slab(-3.2, 2.8, 0, 0.1, 15.44, 15.56, alu); slab(-3.2, 2.8, LH - 0.2, LH, 15.42, 15.58, alu); slab(-0.95, 0.95, 2.3, LH - 0.2, 15.44, 15.56, alu);
  for (const sx of [-1, 1]) { const g = new THREE.Group(); g.position.set(sx * 0.46, 0, 15.5); scene.add(g);
    slab(-0.47, 0.47, 0, 2.3, -0.025, 0.025, alu, g); const gl = slab(-0.41, 0.41, 0.12, 2.22, -0.03, 0.03, sfGlass, g); gl.renderOrder = 3;
    LDOOR.panels.push({ g, sx }); }
  colliders.push({ minX: -3.25, maxX: -0.9, minZ: 15.42, maxZ: 15.6 }, { minX: 0.9, maxX: 2.85, minZ: 15.42, maxZ: 15.6 }, LDOOR.col);
  // the non-lobby ground floor is other tenants: solid
  block2(colliders, X0, BLD.x1, BLD.z0, 7.63); block2(colliders, X0, -3.27, SB + 0.07, 15.45); block2(colliders, 8.35, BLD.x1, 7.7, 15.45);
  block2(colliders, 2.87, ELEV.x0, SB, BLD.z1); block2(colliders, MST.x1 + 0.1, BLD.x1, SB, 15.45);
  for (const o of scene.children.slice(n0)) LOBBY.add(o);
  BCOL.push(...colliders.splice(c0));
}

// ===== exterior: 3-story brick building (east wing over DM + the south block, west wing over the warehouse), signs, canopy =====
// Facades are single-sided textured planes (one canvas texture, UVs in meters) so from inside DM you still see out the windows.
{
  const facadeTex = ground => canvasTex(512, 1024, (g, w, h) => {
    const PX = w / 6, PY = h / 14, Y = m => h - m * PY;
    g.fillStyle = '#7d4f3c'; g.fillRect(0, 0, w, h);
    for (let y = 0, row = 0; y < h; y += 5.6, row++) { const off = row % 2 ? 0 : 8.5; for (let x = -17 + off; x < w; x += 17) { const v = Math.random() * 26; g.fillStyle = `rgb(${132 + v},${82 + v * 0.6},${62 + v * 0.4})`; g.fillRect(x + 0.8, y + 0.8, 15.4, 4.2); } }
    for (const x of [0, w]) { g.fillStyle = 'rgba(60,30,20,.25)'; g.fillRect(x - 14, 0, 28, h); }                       // pilasters at the bay lines
    for (let fl = 0; fl < 3; fl++) {
      const b = fl * 4.4;
      if (fl > 0 || ground !== 'blank') {
        const y0 = Y(b + 2.75), y1 = Y(b + 0.6);
        g.fillStyle = '#d8cfbd'; g.fillRect(0, y1, w, 0.16 * PY);                                                // precast sill
        g.fillStyle = '#26323c'; g.fillRect(20, y0, w - 40, y1 - y0);
        const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(200,222,240,.45)'); gr.addColorStop(0.5, 'rgba(90,120,145,.15)'); gr.addColorStop(1, 'rgba(20,30,40,.1)'); g.fillStyle = gr; g.fillRect(20, y0, w - 40, y1 - y0);
        g.fillStyle = '#1b1f24'; for (let k = 0; k <= 4; k++) g.fillRect(20 + k * (w - 40) / 4 - 3, y0, 6, y1 - y0); g.fillRect(20, y0 - 4, w - 40, 6);
      } else { g.fillStyle = 'rgba(40,25,18,.12)'; g.fillRect(0, Y(3.4), w, 0.5 * PY); }
      if (fl > 0) { g.fillStyle = '#cfc6b4'; g.fillRect(0, Y(b + 0.15), w, 0.3 * PY); }                                // floor band
    }
    g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, w, 0.45 * PY); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0.45 * PY, w, 3);   // coping
    g.fillStyle = '#5a3a2c'; g.fillRect(0, Y(0.45), w, 0.45 * PY);                                                  // plinth
  });
  const tOffice = facadeTex('office'), tBlank = facadeTex('blank');
  for (const t of [tOffice, tBlank]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  const mats = { office: new THREE.MeshStandardMaterial({ map: tOffice, roughness: 0.9, emissive: '#ffffff', emissiveMap: tOffice, emissiveIntensity: 0.18 }),
    blank: new THREE.MeshStandardMaterial({ map: tBlank, roughness: 0.9, emissive: '#ffffff', emissiveMap: tBlank, emissiveIntensity: 0.18 }) };
  // plane along a face. ry 0 = faces +z (south), PI = north, PI/2 = east, -PI/2 = west. a0/a1 run left->right as seen from outside.
  function face(kind, ry, fixed, a0, a1, y0 = BY, y1 = BLD.top, uOff = 0) {
    const len = a1 - a0, hgt = y1 - y0, geo = new THREE.PlaneGeometry(len, hgt), uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + len / 2 + uOff) / 6, (pos.getY(i) + hgt / 2 + y0 - BY) / 14);
    const m = new THREE.Mesh(geo, mats[kind]), mid = (a0 + a1) / 2, ym = (y0 + y1) / 2;
    if (ry === 0) m.position.set(mid, ym, fixed); else if (ry === Math.PI) m.position.set(-mid, ym, fixed);
    else if (ry > 0) m.position.set(fixed, ym, -mid); else m.position.set(fixed, ym, mid);
    m.rotation.y = ry; m.receiveShadow = true; EXT.add(m); return m;
  }
  const B = BASE, WX0 = B.x0 - 0.12, WZ0 = B.z0 - 0.12, WZ1 = B.z1 + 0.12;
  // east wing: south face (entrance hole x -3.2..2.8 up to the lobby ceiling), east, north, west (south of the warehouse)
  face('office', 0, BLD.z1, BLD.x0, -3.2); face('office', 0, BLD.z1, 2.8, BLD.x1, BY, BLD.top, 2.8 - BLD.x0); face('office', 0, BLD.z1, -3.2, 2.8, BY + 3.6, BLD.top, -3.2 - BLD.x0);
  face('office', Math.PI / 2, BLD.x1, -BLD.z1, -BLD.z0);                       // east (a runs -z..)
  face('office', Math.PI, BLD.z0, -BLD.x1, -BLD.x0);                           // north
  face('office', -Math.PI / 2, BLD.x0, WZ1, BLD.z1);                           // west, south of the warehouse wing
  face('blank', Math.PI / 2, BLD.x0, -BLD.z0, -WZ0);                         // sliver where the wings meet (north jog, faces east)
  // west wing (warehouse on the ground floor): north, west, south (dock door hole)
  face('blank', Math.PI, WZ0, 11.12, -WX0);                                    // north (x from -11.12 to WX0)
  face('blank', -Math.PI / 2, WX0, WZ0, WZ1);                                  // west
  const DK = [BAY.doors[0].x0, BAY.doors[0].x1], D2 = [BAY.doors[1].x0, BAY.doors[1].x1]; // HQ #84: two bay holes
  face('blank', 0, WZ1, WX0, D2[0]); face('blank', 0, WZ1, D2[0], D2[1], BY + 3.2, BLD.top, D2[0] - WX0); face('blank', 0, WZ1, D2[1], DK[0], BY, BLD.top, D2[1] - WX0);
  face('blank', 0, WZ1, DK[1], BLD.x0, BY, BLD.top, DK[1] - WX0); face('blank', 0, WZ1, DK[0], DK[1], BY + 3.2, BLD.top, DK[0] - WX0); face('blank', 0, WZ1, DK[0], DK[1], BY, BY + BAY.doors[0].sill, DK[0] - WX0);
  // roofs (thin slabs, no shadows so the office keeps its daylight) + parapet caps
  const roofM = std('#6f6a64', 0.95), capM = std('#d9d2c3', 0.85);
  slab(BLD.x0, BLD.x1, BLD.top - 0.5, BLD.top - 0.4, BLD.z0, BLD.z1, roofM, EXT); slab(WX0, BLD.x0, BLD.top - 0.5, BLD.top - 0.4, WZ0, WZ1, roofM, EXT);
  slab(BLD.x0 - 0.06, BLD.x1 + 0.06, BLD.top, BLD.top + 0.08, BLD.z1 - 0.3, BLD.z1 + 0.06, capM, EXT); slab(WX0 - 0.06, BLD.x1 + 0.06, BLD.top, BLD.top + 0.08, WZ0 - 0.06, WZ0 + 0.3, capM, EXT);
  // the warehouse dock from outside: roll-up door, bumpers, dock light, plate
  { // HQ #84: the curtains themselves are in BAYG (shared with the inside); this is the dressing on the yard side
    const D2c = (D2[0] + D2[1]) / 2, jamb = std('#55595f', 0.5, 0.6);
    for (const x of [...DK, ...D2]) slab(x - 0.06, x + 0.06, BY, BY + 3.25, WZ1, WZ1 + 0.08, jamb, EXT);
    slab(D2[0] - 0.06, D2[1] + 0.06, BY + 3.2, BY + 3.3, WZ1, WZ1 + 0.08, jamb, EXT);
    for (const x of D2) slab(x + (x === D2[0] ? -0.45 : 0.15), x + (x === D2[0] ? -0.15 : 0.45), BY, BY + 1.0, WZ1 + 0.05, WZ1 + 0.35, std('#e8c21c', 0.6), EXT); // bollard blocks
    const p2 = plate('DOCK 2', D2c, BY + 3.6, WZ1 + 0.01, 0, { w: 0.8, sub: 'GROUND LEVEL · DRIVE-IN' }); scene.remove(p2); EXT.add(p2);
    for (const x of DK) slab(x + (x === DK[0] ? 0.1 : -0.35), x + (x === DK[0] ? 0.35 : -0.1), BY + 0.6, BY + 1.1, WZ1, WZ1 + 0.18, std('#111', 0.9), EXT);
    const pl = plate('DOCK 1', (DK[0] + DK[1]) / 2, BY + 3.6, WZ1 + 0.01, 0, { w: 0.8, sub: 'DUNDER MIFFLIN · SHIPPING & RECEIVING' }); scene.remove(pl); EXT.add(pl); }
  // entrance canopy on two posts + address fascia
  const dark = std('#2b2e33', 0.4, 0.6);
  slab(-2.6, 2.2, BY + 3.62, BY + 3.8, BLD.z1, BLD.z1 + 1.9, dark, EXT); { const l = slab(-2.5, 2.1, BY + 3.6, BY + 3.62, BLD.z1 + 0.05, BLD.z1 + 1.85, M.light, EXT); }
  for (const x of [-2.45, 2.05]) { slab(x - 0.06, x + 0.06, BY, BY + 3.62, BLD.z1 + 1.72, BLD.z1 + 1.84, dark, EXT); BCOL.push({ minX: x - 0.12, maxX: x + 0.12, minZ: BLD.z1 + 1.66, maxZ: BLD.z1 + 1.9 }); }
  { const s = sign('1725 SLOUGH AVENUE', -0.2, BY + 3.71, BLD.z1 + 1.91, 0, { w: 2.6, h: 0.16, bg: '#2b2e33', fg: '#e8e2d2', font: 'Georgia,serif', weight: 700 }); scene.remove(s); EXT.add(s); }
  // tenant signs on the facade (placeholders until Graphic Design / Andy does real art): DUNDER MIFFLIN up top, VANCE on its side
  { const m = pngSign('dunder-mifflin', -5.4, BY + 12.45, BLD.z1 + 0.02, 0, 4.6); scene.remove(m); EXT.add(m); }
  { const s = sign('VANCE REFRIGERATION', 6.3, BY + 12.45, BLD.z1 + 0.02, 0, { w: 4.0, h: 0.66, bg: '#0d4c92', fg: '#ffffff', font: '"Arial Black",Arial', weight: 800 }); scene.remove(s); EXT.add(s); }
  { const s = plate('TENANTS', 3.25, BY + 1.55, BLD.z1 + 0.02, 0, { w: 0.6, sub: 'DUNDER MIFFLIN 200 · VANCE 201' }); scene.remove(s); EXT.add(s); }
  // exterior walls at ground level (lot side): east wing outline with the entrance gap, the west face down to the yard
  BCOL.push({ minX: BLD.x0, maxX: BLD.x1 + 0.1, minZ: BLD.z0 - 0.12, maxZ: BLD.z0 + 0.12 }, { minX: BLD.x1 - 0.12, maxX: BLD.x1 + 0.12, minZ: BLD.z0, maxZ: BLD.z1 + 0.05 },
    { minX: BLD.x0 - 0.12, maxX: -3.2, minZ: BLD.z1 - 0.2, maxZ: BLD.z1 + 0.05 }, { minX: 2.8, maxX: BLD.x1 + 0.1, minZ: BLD.z1 - 0.2, maxZ: BLD.z1 + 0.05 },
    { minX: BLD.x0 - 0.12, maxX: BLD.x0 + 0.1, minZ: B.z1, maxZ: BLD.z1 + 0.05 });
}
function updateLobbyDoor(dt, px, pz, lv) {
  const near = lv === -1 && Math.abs(px + 0.0) < 2.4 && Math.abs(pz - 15.5) < 2.8;
  LDOOR.open += Math.sign((near ? 1 : 0) - LDOOR.open) * Math.min(Math.abs((near ? 1 : 0) - LDOOR.open), (near ? 2.4 : 1.2) * dt);
  const e = LDOOR.open * LDOOR.open * (3 - 2 * LDOOR.open);
  for (const { g, sx } of LDOOR.panels) g.position.x = sx * (0.46 + 0.86 * e);
  const shut = LDOOR.open < 0.6; LDOOR.col.minX = shut ? -0.9 : 1e9; LDOOR.col.maxX = shut ? 0.9 : 1e9;
}
// elevator: walk in, wait a beat, the doors close and it takes you to the other floor. Walk up to the doors on a floor the car
// isn't on and it comes to you. Steps in the doorway re-open closing doors.
function updateElevator(dt) {
  const { x, z } = player.pos, lv = player.level, inside = inCar(x, z), [d0, d1] = ELEV.door;
  const near = !inside && x > d0 - 1.6 && x < d1 + 1.6 && z > SB - 2.4 && z < SB;
  const inDoorway = x > d0 - 0.3 && x < d1 + 0.3 && z > SB - 0.45 && z < SB + 0.45;
  if (!inside) ELEV.armed = true;
  if (ELEV.state === 'idle') {
    const here = ELEV.at === lv;
    if (near && !here) { ELEV.state = 'closing'; ELEV.to = lv; ELEV.rider = false; }
    else if (here && (near || inside)) { ELEV.want = 1; ELEV.hold = 2.5; }
    else if ((ELEV.hold -= dt) <= 0) ELEV.want = 0;
    if (inside && here && ELEV.armed && ELEV.open > 0.95) {
      if ((ELEV.dwell += dt) > 0.8) { ELEV.state = 'closing'; ELEV.to = ELEV.at === 0 ? -1 : 0; ELEV.rider = true; ELEV.dwell = 0; toast(ELEV.to === -1 ? '🛗 Going down · 1 · Lobby + warehouse' : '🛗 Going up · 2 · Dunder Mifflin + Vance Refrigeration', 2600); }
    } else ELEV.dwell = 0;
  }
  if (ELEV.state === 'closing') {
    ELEV.want = 0;
    if (inDoorway && ELEV.at === lv && !inside) { ELEV.state = 'idle'; ELEV.want = 1; ELEV.hold = 2.5; }     // someone in the doors: re-open
    else if (ELEV.open <= 0.001) {
      if (ELEV.to === ELEV.at) ELEV.state = 'idle';
      else { ELEV.state = 'moving'; ELEV.t = 0; ELEV.from = ELEV.y; ELEV.rider = ELEV.rider && inside; }
    }
  }
  if (ELEV.state === 'moving') {
    ELEV.t = Math.min(1, ELEV.t + dt / 3.6); const e = ELEV.t * ELEV.t * (3 - 2 * ELEV.t), y1 = ELEV.to === 0 ? 0 : BY;
    ELEV.y = ELEV.from + (y1 - ELEV.from) * e;
    if (ELEV.rider) { player.y = ELEV.y; player.level = ELEV.y < BY / 2 ? -1 : 0; }
    if (ELEV.t >= 1) { ELEV.at = ELEV.to; ELEV.state = 'idle'; ELEV.want = 1; ELEV.hold = 4; if (ELEV.rider) { ELEV.armed = false; player.level = ELEV.at; player.y = ELEV.y; } ELEV.rider = false; }
  }
  const k = ELEV.want ? 1.5 : 1.1;
  ELEV.open += Math.sign(ELEV.want - ELEV.open) * Math.min(Math.abs(ELEV.want - ELEV.open), k * dt);
  const e = ELEV.open * ELEV.open * (3 - 2 * ELEV.open), slide = 0.6 * e;
  for (const d of elevDoors.car) d.m.position.x = d.x + d.sx * slide;
  for (const d of elevDoors.hall0) d.m.position.x = d.x + d.sx * (ELEV.at === 0 && ELEV.state !== 'moving' ? slide : 0);
  for (const d of elevDoors.hallG) d.m.position.x = d.x + d.sx * (ELEV.at === -1 && ELEV.state !== 'moving' ? slide : 0);
  ELEVCAR.position.y = ELEV.y;
  const openOK = ELEV.open > 0.7 && ELEV.state !== 'moving';
  ELEV.col0.minX = openOK && ELEV.at === 0 ? 1e9 : d0; ELEV.col0.maxX = openOK && ELEV.at === 0 ? 1e9 : d1;
  ELEV.colG.minX = openOK && ELEV.at === -1 ? 1e9 : d0; ELEV.colG.maxX = openOK && ELEV.at === -1 ? 1e9 : d1;
  const label = ELEV.state === 'moving' ? (ELEV.to === 0 ? '▲' : '▼') + (ELEV.y < BY / 2 ? '1' : '2') : ELEV.at === 0 ? '2' : '1';
  if (label !== ELEV.shown) { ELEV.shown = label; drawElevIndicator(label); }
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
let needsT = 0, talk = null; // HQ #54 speech bubbles (talk.js), created right after the workers
const workers = createWorkers({ scene, stations, colliders, pois: IDLE_SPOTS, onStatus: (s, busy, task, meta = {}) => {
  const st = stations.find(x => x.id === s.id); if (!st) return;
  st.busy = busy; st.task = task; monitors.setStatus(st.id, busy, task, meta.since, meta.until, { stage: meta.stage, pct: meta.pct, waiting: meta.waiting });
  talk?.onStatus(st, busy, task, meta);
  if (panelOpen === st) showPanel(st);
} });
// HQ #54: speech bubbles above whoever is talking; each teammate reacts in character to real events (voices.js, local, free)
talk = createTalk({ scene, workers, stations, camera });


// ---------- player ----------
const player = { pos: new THREE.Vector3(0, 0, 6.9), yaw: 0, pitch: 0, radius: 0.3, travel: null, level: 0, y: 0 };
// HQ #79/#81: level 0 = the 2nd floor (Dunder Mifflin + the hallway), -1 = ground level (lobby, warehouse, sidewalk, lot).
// Each floor has its own colliders; stair and elevator walls are in both sets. On stairs the floor height follows the steps
// and the level flips halfway; in the elevator it flips mid-ride.
function blocked(x, z, lv = player.level) {
  const r = player.radius;
  for (const c of lv === -1 ? BCOL : colliders) if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
  return false;
}
// HQ #83: corner switchback. Top landing (y 0) -> flight A (north, down the east wall) -> corner landing -> flight B (west).
const onStairs = (x, z) => x < X0 && z <= WST.zP + 0.1 && z >= WST.zN - 0.1 && (x > WST.xr - 0.1 || (z < WST.zA1 + 0.1 && x >= WST.xB1));
function stairY(x, z) {
  const S = WST;
  if (x > S.xr - 0.1 && z >= S.zA0) return 0;
  if (x > S.xr - 0.1 && z >= S.zA1) return S.yM * (S.zA0 - z) / (S.zA0 - S.zA1);
  if (x > S.xr) return S.yM;
  return S.yM + (BY - S.yM) * Math.min(1, (S.xr - x) / (S.xr - S.xB1));
}
function updateLevel() {
  const { x, z } = player.pos;
  if (ELEV.state === 'moving' && ELEV.rider) { player.y = ELEV.y; player.level = ELEV.y < BY / 2 ? -1 : 0; }
  else if (onStairs(x, z)) { player.y = stairY(x, z); player.level = player.y < BY / 2 ? -1 : 0; }
  else if (inCore(x, z)) { const [y, lv] = coreY(x, z); player.y = y; player.level = lv; }
  else player.y = player.level === -1 ? BY + dockY(x, z) : 0;
}
// HQ #84: Dock 1 ramp -> dock platform -> truck bed (all 0.75 above the yard)
function dockY(x, z) {
  const d = BAY.doors[0], R = BAY.ramp;
  if (x < d.x0 || x > d.x1 || z < R.z0 || z > BAY.truckZ1) return 0;
  return z < R.z1 ? d.sill * (z - R.z0) / (R.z1 - R.z0) : d.sill;
}
function updateBays(dt, px, pz, lv) {
  let any = false;
  for (const d of BAY.doors) {
    const cx = (d.x0 + d.x1) / 2, zFar = d.truck ? BAY.truckZ1 + 0.3 : BASE.z1 + 3.4;
    const near = lv === -1 && Math.abs(px - cx) < 3.0 && pz > (d.truck ? BAY.ramp.z0 - 1.6 : BASE.z1 - 4.2) && pz < zFar; // Dock 1: from the foot of its ramp
    d.hold = near ? 1.4 : Math.max(0, d.hold - dt);
    const target = near || d.hold > 0 ? 1 : 0;
    if (target === d.open) { if (d.open) any = true; continue; }          // at rest: nothing to animate
    if (target && d.open === 0 && performance.now() - BAY.told > 20000) { BAY.told = performance.now(); toast(d.truck ? '🚚 Dock 1 rolling up · ramp up into the truck' : '🚪 Dock 2 rolling up · out to the truck yard', 2600); }
    const k = target ? 0.75 : 0.55;                                          // ~1.3 s up, ~1.8 s down, like a motorized roll-up
    d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), k * dt);
    const e = d.open * d.open * (3 - 2 * d.open);
    d.curtain.position.y = d.sill + d.ch / 2 + e * (d.ch + 0.1);              // slides up into the wall above the opening
    const shut = d.open < 0.8; d.col.minX = shut ? d.x0 : 1e9; d.col.maxX = shut ? d.x1 : 1e9;
    if (d.truck && BAY.truckDoor) { const f = Math.max(0, Math.min(1, (d.open - 0.25) / 0.75)), te = f * f * (3 - 2 * f);   // the truck's own rear door follows
      BAY.truckDoor.scale.y = Math.max(0.04, 1 - te); BAY.truckDoor.position.y = 3.02 - 1.12 * BAY.truckDoor.scale.y; }
    if (d.open > 0) any = true;
  }
  BAY.anyOpen = any;
}
// iPad LOD (HQ #79 rule kept: the light count never changes, only intensities): draw the floor you're on.
//  - 2nd floor: the office + hallway (+ the warehouse group only near its stairs); the lot, lobby, facades are hidden
//  - ground: the lobby + facades + lot; the whole 2nd floor (desks, workers, monitors, whiteboard...) is hidden
//  - warehouse: only the warehouse (+ its stairs); outside + lobby hidden. Stair/elevator cores draw only when you're near them.
const HEMI = scene.children.find(o => o.isHemisphereLight);
scene.add(sun.target);
const KEEP = new Set([BASEMENT, BAYG, OUTSIDE, EXT, LOBBY, CORE, ELEVCAR, GROUNDS, WSTAIR, WHD.pivot, sun.target]); // HQ #83: the warehouse door leaf shows from both sides
const hiddenOffice = new Set(); let officeHidden = false;
function setOfficeHidden(h) {
  if (h) { for (const o of scene.children) if (o.visible && !o.isLight && !KEEP.has(o)) { o.visible = false; hiddenOffice.add(o); } }
  else if (officeHidden) { for (const o of hiddenOffice) o.visible = true; hiddenOffice.clear(); }
  officeHidden = h;
}
const FLOORS = { zone: 'office' };
function updateFloors() {
  const { x, z } = player.pos, ground = player.level === -1, wStairs = onStairs(x, z);
  const inWH = ground && !wStairs && x < BASE.x1 + 0.05 && x > BASE.x0 - 0.5 && z > BASE.z0 - 0.5 && z < BASE.z1 + 0.1;
  const byWHdoor = ground && x < -5.5 && z > 7.6 && z < SB;                     // lobby hall, looking at the warehouse door
  const nearWStairs = (!ground && x < -7.5 && z > -6.5 && z < -0.8) || WHD.open > 0.02; // 2nd floor, by the warehouse door (HQ #83)
  const core = inCore(x, z) || inCar(x, z);
  const byDocks = ground && BAY.anyOpen && x > BASE.x0 - 1 && x < BASE.x1 && z > BASE.z1 - 7 && z < BASE.z1 + 9; // HQ #84: see through an open bay
  BASEMENT.visible = inWH || byWHdoor || wStairs || nearWStairs || byDocks;
  WSTAIR.visible = BASEMENT.visible; // HQ #83: stairs only drawn with the warehouse (near them / on them / downstairs)
  EXT.visible = OUTSIDE.visible = ground && (!inWH || byDocks) && !core;
  BAYG.visible = BASEMENT.visible || EXT.visible;   // no outside view from the stairwell / elevator
  LOBBY.visible = ground && (!inWH || (x > -14.5 && z > 6));
  CORE.visible = ELEVCAR.visible = Math.abs(x - 5.4) < 10 && z > 3 && z < 21;
  const seeUp = inCore(x, z) && (x > MST.xm || z > MST.zb - 0.4);               // mid landing: you can see up flight A to the hallway
  setOfficeHidden((ground && !wStairs && !seeUp) || (wStairs && player.y < -1.0 && WHD.open < 0.02)); // HQ #83: below the door the office can't be seen
  // light: daylight everywhere except down in the warehouse (fades on its stairs, as in HQ #79)
  const t = wStairs ? Math.max(0, Math.min(1, -player.y / -BY * 1.6 - 0.3)) : inWH ? (byDocks ? 0.55 : 1) : 0;
  sun.intensity = 1.6 * (1 - t); winFill.intensity = 0.55 * (1 - t); warm.intensity = 6 * (1 - t);
  HEMI.intensity = 1.15 - 0.55 * t;
  whLight.intensity = BASEMENT.visible ? 4 + 10 * t : 0; whLight2.intensity = whLight.intensity;
  // the warm reception light doubles as the lobby light when you're on the ground floor (moving a light = no shader rebuild)
  if (ground && !inWH) warm.position.set(-0.2, BY + 3.0, 11.8); else if (!ground && z > Z1 - 0.3) warm.position.set(x < -4 ? -5 : x > 5 ? 5 : x, 2.7, 8.8); else warm.position.set(0, 2.6, 4.2);
  // sun shadows follow you outside (snapped so they don't shimmer); upstairs they stay centred on the office like before
  const tx = ground && !inWH ? Math.round(x / 4) * 4 : 0, tz = ground && !inWH ? Math.round(z / 4) * 4 : 0, ty = ground ? BY : 0;
  if (sun.target.position.x !== tx || sun.target.position.z !== tz || sun.target.position.y !== ty) { sun.target.position.set(tx, ty, tz); sun.position.set(tx + 6, ty + 20, tz - 8); sun.target.updateMatrixWorld(); }
  FLOORS.zone = inWH ? 'warehouse' : ground ? 'ground' : 'office';
}
function tryMove(dx, dz) {
  if (ELEV.state === 'moving' && ELEV.rider) return; // riding: hold still
  if (!blocked(player.pos.x + dx, player.pos.z)) player.pos.x += dx;
  if (!blocked(player.pos.x, player.pos.z + dz)) player.pos.z += dz;
  updateLevel();
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
  if (CAN_LOCK && !document.pointerLockElement && !paused && !chat.isOpen() && !suggestBox.isOpen() && lastInput === 'mouse') setPaused(true);
});
let lastInput = 'mouse';
addEventListener('mousemove', e => { if (document.pointerLockElement) { mouseDX += e.movementX; mouseDY += e.movementY; lastInput = 'mouse'; } });
addEventListener('keydown', e => {
  if (chat.isOpen() || suggestBox.isOpen()) { // typing in chat / suggestion box: don't walk / interact
    if (e.code === 'Escape') { e.preventDefault(); if (suggestBox.isOpen()) suggestBox.close(); else chat.close(); }
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
  if (player.level !== 0) return null; // desks are upstairs
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
  if (ELEV.state === 'moving' && ELEV.rider) return;
  player.level = 0; player.y = 0; // Y from downstairs / the lobby: hop straight back up to the desk
  player.travel = { from: player.pos.clone(), to, yaw0: player.yaw, yaw1: Math.atan2(-(s.monitor.x - to.x), -(s.monitor.z - to.z)), t: 0 };
}
// HQ #38: desks are packed like the show, so the usual over-the-shoulder spot can land inside a neighbour's desk.
// Walk the candidates (behind the chair, then closer, then to either side) and take the first one that's clear.
function freeStand(s) {
  for (const back of [1.7, 1.4, 1.15, 0.95]) for (const side of [0.6, -0.6, 0, 1.1, -1.1]) {
    const v = new THREE.Vector3(side * s.s, 0, s.dd / 2 + back).applyMatrix4(s.group.matrixWorld);
    const e = 0.12; // a little clearance so the spot isn't wedged against a desk edge
    if (!blocked(v.x, v.z, 0) && !blocked(v.x + e, v.z, 0) && !blocked(v.x - e, v.z, 0) && !blocked(v.x, v.z + e, 0) && !blocked(v.x, v.z - e, 0)) return new THREE.Vector3(v.x, 0, v.z);
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
  const lv = player.level;
  const room = ROOMS.find(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && (r.level === 'any' || (r.level ?? 0) === lv));
  const area = room ? room.name : lv === -1 ? 'outside, around the building' : Math.hypot(x - COOLER.x, z - COOLER.z) < 3 ? 'by the water cooler' : Math.hypot(x - X0, z + 3.65) < 2.2 ? 'by the warehouse door (metal stairs down)'
    : z > 2.6 ? (x > 2.6 ? 'by Jim + Dwight (outside Michael\'s office)' : 'reception (Pam\'s desk)') : x > -5.6 && x < -1.6 && z > -3.0 && z < 0.4 ? 'accounting' : z < -4.8 ? 'back of the bullpen (window side)' : 'the bullpen';
  return { x, z, heading, facing, area, level: lv, near: lv === 0 && near && near.d < 4 ? near : null };
}
function stampWhere(g, w, h) {
  const p = whereAmI(), k = Math.max(0.6, w / 1280);
  const fl = ELEV.state === 'moving' && ELEV.rider ? ' · in the elevator' : player.y < -0.05 && player.y > BY + 0.05 && !(p.level === -1 && dockY(player.pos.x, player.pos.z) > 0) ? ' · on the stairs' : p.level === -1 ? (FLOORS.zone === 'warehouse' ? ' · DOWNSTAIRS (ground floor)' : ' · GROUND FLOOR') : ' · 2nd floor';
  const line1 = `📍 Chris at x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)}${fl} · facing ${p.facing} (${Math.round(p.heading)}°)`;
  const line2 = `${p.area}${p.near ? ` · near ${p.near.s.name}${p.near.s.bot ? ` (${p.near.s.bot})` : ''}${p.near.s.desk ? ` · ${p.near.s.desk}` : `'s desk`} (${p.near.d.toFixed(1)} m)` : ''} · north = window wall`;
  g.font = `600 ${Math.round(22 * k)}px system-ui,Arial`;
  const bw = Math.max(g.measureText(line1).width, g.measureText(line2).width) + 28 * k, bh = 66 * k;
  g.fillStyle = 'rgba(0,0,0,.62)'; roundRect(g, 10 * k, 10 * k, bw, bh, 10 * k); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(line1, 24 * k, 18 * k);
  g.fillStyle = '#ffd59a'; g.font = `500 ${Math.round(19 * k)}px system-ui,Arial`; g.fillText(line2, 24 * k, 44 * k);
  // mini floor map (top-down, north up). HQ #81: whole site; the floor you're on is drawn solid, the other one dashed
  const SW = SITE.x1 - SITE.x0, SD = SITE.z1 - SITE.z0, down = player.level === -1;
  const mw = 230 * k, mh = mw * SD / SW, mx = w - mw - 12 * k, my = 30 * k, sx = mw / SW, sz = mh / SD;
  const P = (x, z) => [mx + (x - SITE.x0) * sx, my + (z - SITE.z0) * sz];
  const R = (x0, z0, x1, z1) => [...P(x0, z0), (x1 - x0) * sx, (z1 - z0) * sz];
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(mx - 6 * k, my - 6 * k, mw + 12 * k, mh + 12 * k);
  g.fillStyle = '#8fae6b'; g.fillRect(mx, my, mw, mh);                                              // grass
  g.fillStyle = '#4a4c50'; g.fillRect(...R(-20, 17.8, 20.6, 34.6)); g.fillRect(...R(20.6, SITE.z0, 24.4, SITE.z1)); g.fillRect(...R(-27.3, 10.2, -11.1, 17.8)); // lot, road, truck yard
  g.fillStyle = '#c9c4ba'; g.fillRect(...R(-11.2, 15.6, 11.2, 17.8));                                // sidewalk
  g.fillStyle = '#7a5a4a'; g.fillRect(...R(BLD.x0, BLD.z0, BLD.x1, BLD.z1)); g.fillRect(...R(BASE.x0 - 0.12, BASE.z0 - 0.12, BLD.x0, BASE.z1 + 0.12)); // building footprint
  g.strokeStyle = '#f0e6c8'; g.lineWidth = 1.5 * k;
  if (down) {
    g.fillStyle = 'rgba(154,152,144,.95)'; g.fillRect(...R(BASE.x0, BASE.z0, BASE.x1, BASE.z1));    // warehouse
    g.fillStyle = '#e6dcc8'; g.fillRect(...R(-11, 7.7, 8.4, SB)); g.fillRect(...R(-3.2, SB, 2.8, 15.45)); // lobby
    g.fillStyle = '#fff'; g.fillRect(...R(-0.9, 15.3, 0.9, 15.8));                                   // building entrance
    g.save(); g.setLineDash([4 * k, 3 * k]); g.strokeRect(...R(X0, Z0, X1, Z1)); g.restore();
  } else {
    g.save(); g.setLineDash([4 * k, 3 * k]); g.strokeRect(...R(BASE.x0, BASE.z0, BASE.x1, BASE.z1)); g.restore();
    g.fillStyle = '#b9c2cc'; g.fillRect(...R(X0, Z0, X1, Z1));                                       // DM office
    g.fillStyle = '#7fc4ff'; g.fillRect(...P(X0, Z0), W * sx, 3 * k); g.fillRect(P(X1, 0)[0] - 3 * k, P(0, Z0)[1], 3 * k, D * sz); // windows N + E
    g.fillStyle = '#d6cdb8'; g.fillRect(...R(X0, Z1, X1, SB));                                        // hallway
    g.fillStyle = '#5ab0ff'; g.fillRect(...R(-2.6, SB, 2.0, 13.0));                                   // Vance Refrigeration
    g.fillStyle = '#fff'; g.fillRect(...R(-0.8, Z1 - 0.3, 0.8, Z1 + 0.3));                            // DM's doors
  }
  g.fillStyle = '#e8c21c'; g.fillRect(...R(WST.xr, WST.zN, X0, WST.zP)); g.fillRect(...R(WST.xB1, WST.zN, WST.xr, WST.zA1)); g.fillRect(...R(MST.x0, SB, MST.x1, MST.zs)); // stairs
  g.fillStyle = '#9fa6ad'; g.fillRect(...R(ELEV.x0, SB, ELEV.x1, ELEV.z1));                            // elevator
  g.strokeStyle = 'rgba(40,50,70,.9)'; g.lineWidth = 1.5 * k;
  if (!down) for (const r of ROOMS) if (!r.outside) g.strokeRect(...P(r.x0, r.z0), (r.x1 - r.x0) * sx, (r.z1 - r.z0) * sz);
  if (!down) for (const s of stations) { const [a, b] = P(s.x, s.z); g.fillStyle = s.color; g.fillRect(a - 3 * k, b - 3 * k, 6 * k, 6 * k); }
  if (!down) { const [a, b] = P(COOLER.x, COOLER.z); g.fillStyle = '#1e6fe0'; g.beginPath(); g.arc(a + 3 * k, b, 4 * k, 0, 7); g.fill(); }
  const [px, pz] = P(p.x, p.z), ang = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw)); // canvas angle of facing
  g.fillStyle = 'rgba(255,230,120,.45)'; g.beginPath(); g.moveTo(px, pz); g.arc(px, pz, 34 * k, ang - 0.6, ang + 0.6); g.closePath(); g.fill();
  g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 2 * k; g.beginPath(); g.arc(px, pz, 5 * k, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(13 * k)}px system-ui,Arial`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillText(down ? 'N · GROUND FLOOR' : 'N (windows) · 2nd FLOOR', mx + mw / 2, my - 7 * k);
}
function snapshot(maxW = HQ_HD ? 1600 : 1280, q = HQ_HD ? 0.85 : 0.7) { // HQ #102: sharper chat screenshots on HD
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
// HQ #85: the Design Trainer wall downstairs. 'swipe:keep|pass|undo|shuffle|idle' while the reticle / tap is on it (< 7 m)
function swipeHit() {
  if (player.level !== -1 || !BASEMENT.visible || player.pos.x > BASE.x1 || Math.hypot(player.pos.x - SWIPE_AT.x, player.pos.z - SWIPE_AT.z) > 7.5) return null;
  raycaster.far = 8;
  const h = raycaster.intersectObjects(SUGGEST_MESH ? [swipeWall.mesh, SUGGEST_MESH] : [swipeWall.mesh], false)[0]; if (!h) return null;
  return h.object === SUGGEST_MESH ? 'swipe:suggest' : 'swipe:' + swipeWall.hit(h.uv);
}
// HQ #89: controller works whenever you're standing at the wall facing it (no pixel-perfect aim needed for X / Y / A / B)
function swipeNear() {
  if (player.level !== -1 || !BASEMENT.visible || player.pos.x > BASE.x1) return false;
  const dx = SWIPE_AT.x - player.pos.x, dz = SWIPE_AT.z - player.pos.z, d = Math.hypot(dx, dz); if (d > 6.5) return false;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); return (fx * dx + fz * dz) / (d || 1) > 0.55;
}
function swipeAct(k) {
  const r = swipeWall.act(k);
  if (r === 'keep') toast('✓ KEEP · saved for the designer', 1200);
  else if (r === 'pass') toast('✗ PASS · saved for the designer', 1200);
  else if (r === 'undo') toast('↶ Undid your last swipe · that card is back', 1600);
  else if (r === 'nothing') toast('Nothing to undo yet', 1500);
  else if (r === 'arm') toast('↻ Press RESET again (Y / tap) to clear this round', 2600);
  else if (r === 'reset') toast('↻ Deck reset · card 1 · that round won’t train the designer', 2600);
  else if (r === 'next') toast('✓ Round saved · new shuffled round', 1800);
  else if (r === 'endhint' || r === 'end') toast('Deck done · X undo · Y twice reset · RB new round', 2200);
  else if (r === 'nodeck') toast('The designer’s deck is still loading', 1800);
  else if (r === 'suggest') toast('✉ Suggestion Box · type an idea for Kelly', 1400);
  return r;
}
function refreshHit() {
  if (player.level === -1) return swipeHit();
  if (player.level !== 0) return null;
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
  if (kind.startsWith('swipe:')) { const k = kind.slice(6); if (k !== 'idle') swipeAct(k); return; }
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
  if (r === 'submit') { setTimeout(() => workPoll?.(), 20000); talk?.onPickSent(id, monitors.pickSel(id)); }
}
let workPoll = null;
function tapAt(x, y) {
  if (paused || chat.isOpen() || suggestBox.isOpen()) return false;
  const r = canvasEl.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const k = refreshHit(); if (k) { act(k); return true; }
  return false;
}
function updateHover() {
  let k = null;
  if (!paused && !chat.isOpen() && !suggestBox.isOpen() && !panelOpen) { camera.getWorldDirection(tmpV); raycaster.set(camera.position, tmpV); k = refreshHit(); }
  if (k === hoverKind) return;
  hoverKind = k;
  const pk = k && /^b?pick:/.test(k) ? k.split(':') : null, onBoard = pk && pk[0] === 'bpick';
  whiteboard.setHover(k === 'bank'); monitors.setHover(k === 'inbox' ? 'inbox' : null, true);
  const sw = k && k.startsWith('swipe:') ? k.slice(6) : null; swipeWall.setHover(sw);
  if (sw) { ui.reticle.classList.add('hot'); ui.focus.classList.add('show'); ui.focus.textContent = swipeWall.hint(sw === 'idle' ? 'keep' : sw); return; }
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
  try { const f = JSON.parse(localStorage.getItem(KEY) || 'null'); if (f) { monitors.setWork(f); talk?.onWork(f); } } catch (e) {}
  async function poll() {
    if (document.hidden) return;
    const r = await fetchWorkFeed(); if (!r || r.same || !r.feed) return;
    try { localStorage.setItem(KEY, JSON.stringify(r.feed)); } catch (e) {}
    monitors.setWork(r.feed); talk?.onWork(r.feed);
  }
  workPoll = poll; poll(); setInterval(poll, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
// HQ #85: Design Trainer deck (encrypted per-device feed from tools/swipe-train.mjs). The wall keeps its own copy; polled
// every 20 s while you're downstairs near it, every 2 min otherwise, so a new designer deck shows up without a reload.
(function swipeDeckFeed() {
  let last = 0;
  let busy = false;
  async function poll() { if (document.hidden || busy) return; busy = true; last = Date.now();
    try { const r = await fetchSwipeDeck(!swipeWall.hasDeck); if (r?.feed) swipeWall.setDeck(r.feed); else if (!swipeWall.hasDeck) swipeWall.setStatus(swipeStatus); }
    catch (e) { swipeWall.setStatus('deck error: ' + String(e?.message || e).slice(0, 60)); } finally { busy = false; } }
  poll(); setInterval(() => { const near = player.level === -1 && Math.hypot(player.pos.x - SWIPE_AT.x, player.pos.z - SWIPE_AT.z) < 20; if (Date.now() - last > (!swipeWall.hasDeck ? 10e3 : near ? 20e3 : 120e3)) poll(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); swipeWall.flush(); } });
})();
// HQ #50: taps on a desk screen shown full size in the open desk panel (same canvas as the 3D monitor)
for (const s of stations) {
  const cv = monitors.canvas(s.id); if (!cv || s.hero) continue;
  const hit = (x, y) => { if (panelOpen !== s || !monitors.hasPick(s.id)) return false; const r = cv.getBoundingClientRect();
    const k = monitors.pickHit(s.id, { x: (x - r.left) / r.width, y: 1 - (y - r.top) / r.height }); if (k) { monitors.setPickHover(s.id, k); pickAct(s.id, k); } return !!k; };
  cv.addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (t && hit(t.clientX, t.clientY)) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  cv.addEventListener('click', e => { if (e.pointerType === 'touch') return; if (hit(e.clientX, e.clientY)) e.stopPropagation(); });
}
// HQ #59: one office chat. Safe in-game commands typed in chat ("Phyllis, get out of the way") run here instantly.
function nearestWorker() { // who "move" / "come here" means when no name is given: closest person in front of you, else closest
  let best = null, bd = 1e9;
  for (const w of workers.workers) { const dx = w.x - player.pos.x, dz = w.z - player.pos.z, d = Math.hypot(dx, dz); if (d > 6) continue;
    const ahead = (-Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz) / (d || 1); const score = d - ahead * 1.5; if (score < bd) { bd = score; best = w; } }
  return best?.st.id || null;
}
function runCommands(cmds) { for (const c of cmds) { if (c.act === 'hush') talk?.hush?.(c.bot); else workers.order?.(c.bot, c.act, player); } }
const chat = createChat({ stations, snapshot, near: nearestWorker, onCommands: runCommands, onLog: (entries, all) => { monitors.setLog(all || entries); talk?.onChat(entries); }, onOpenChange: o => {
  if (o) { closePanel(); touch.move = touch.look = null; touch.mx = touch.mz = 0; showKnob(null); if (document.pointerLockElement) document.exitPointerLock(); }
} });
// HQ #59: shared office chat feed (every device's messages, office-bot + Grok Bot replies, teammates' lines + banter)
async function pollChatFeed() { if (document.hidden) return; const r = await fetchChatFeed(); if (r?.feed) chat.setFeed(r.feed.items); }
pollChatFeed(); setInterval(() => { if (chat.isOpen() || Math.random() < 0.5) pollChatFeed(); }, 6000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollChatFeed(); });
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
    if (!viewFired && held >= VIEW_HOLD_MS && !paused && !suggestBox.isOpen()) { viewFired = true; holdHint.classList.remove('show'); rumble(gp.pad, 80, 0.5); chat.isOpen() ? chat.close() : openChat(); }
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
  if (gp && suggestBox.isOpen()) { suggestBox.pad(gp); }
  else if (gp && chat.isOpen()) chat.pad(gp);
  else if (gp) {
    if (gp.start) { setPaused(!paused); }
    else if (paused && gp.A) setPaused(false);
    else if (!paused && !panelOpen && ((hoverKind && hoverKind.startsWith('swipe:')) || swipeNear())) {
      // HQ #85/#89: at the Design Trainer wall: A / RB / ▶ keep, B / LB / ◀ pass, X / ▼ undo, Y twice reset, RB on Deck done = new round
      const k = (hoverKind === 'swipe:suggest' && gp.A) ? 'suggest' : swipeWall.padKey(gp); if (k) { const r = swipeAct(k); if (r === 'keep' || r === 'pass') rumble(gp.pad, r === 'keep' ? 60 : 35, r === 'keep' ? 0.45 : 0.25); else if (r === 'undo' || r === 'reset') rumble(gp.pad, 40, 0.3); }
    }
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
  if (!paused && !chat.isOpen() && !suggestBox.isOpen()) {
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
  if (player.travel) updateLevel();
  updateFrontDoor(dt, player.pos.x, player.pos.z, player.level);
  updateLobbyDoor(dt, player.pos.x, player.pos.z, player.level);
  updateWhDoor(dt, player.pos.x, player.pos.z, player.level);
  updateBays(dt, player.pos.x, player.pos.z, player.level);
  updateElevator(dt);
  updateFloors();
  camera.position.set(player.pos.x, EYE + player.y, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  workers.update(dt, clock.elapsedTime, player);
  if (BASEMENT.visible && WH) WH.update(clock.elapsedTime, player, dt); // HQ #95 desk + HQ #96 forklift / pallet jack work
  talk.update(dt, player);
  if ((needsT += dt) > 2) { needsT = 0; talk.onNeeds(monitors.needs()); }
  if (!hoverKind) setFocus(paused ? null : findFocus()); else if (paused) setFocus(null);
  updateHover();
  monitors.tick(performance.now(), player.pos, (panelOpen || focused)?.id);
  swipeWall.tick(performance.now(), BASEMENT.visible && player.level === -1 && Math.hypot(player.pos.x - SWIPE_AT.x, player.pos.z - SWIPE_AT.z) < 22);
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
  player.pos.set(resume.x, 0, resume.z); player.yaw = resume.yaw; player.pitch = resume.pitch; player.level = resume.level === -1 ? -1 : 0; updateLevel();
  // floor plan changed since that spot was saved (or it's inside a wall now): start at the front door, facing Pam's reception
  if (resume.layout !== LAYOUT) { player.level = -1; player.pos.set(0.5, 0, 32.0); player.yaw = 0; player.pitch = 0.22; updateLevel(); resume.newLayout = true; } // HQ #81: first look = the building from the lot
  else if (blocked(resume.x, resume.z)) { player.level = 0; player.y = 0; player.pos.set(0, 0, 6.9); player.yaw = 0; player.pitch = 0; }
  if (!resume.paused) setPaused(false);
  if (resume.chat) { chat.show(stations.find(s => s.id === resume.chat.to) || stations.find(s => s.hero)); chat.restoreDraft(resume.chat); }
  else if (resume.draft?.text) chat.restoreDraft(resume.draft);
  setTimeout(() => toast(resume.newLayout ? 'New: the real building · lobby → elevator or stairs → Dunder Mifflin on 2 · Vance across the hall' : 'Office updated', resume.newLayout ? 7000 : 2500), 300);
}
function toast(msg, ms = 2500) {
  let el = document.getElementById('livetoast');
  if (!el) { el = document.createElement('div'); el.id = 'livetoast'; el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);background:rgba(24,22,20,.88);color:#ffd59a;padding:8px 16px;border-radius:999px;font:600 14px system-ui,Arial;z-index:50;pointer-events:none;transition:opacity .4s'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, ms);
}
startLiveReload({
  toast,
  isSafe: () => !chat.isSending() && !chat.isTyping(),
  getState: () => ({ layout: LAYOUT, x: player.pos.x, z: player.pos.z, level: player.level, yaw: player.yaw, pitch: player.pitch, paused,
    chat: chat.isOpen() ? chat.draft() : null, draft: chat.draft() }),
});
tick();
// debug hook for automated screenshots
window.__office = { swipeWall, suggestBox, swipeNear, SWIPE_AT, tapAt, BAY, BAYG, dockY, WHD, WST, WSTAIR, stairY, onStairs, renderer, tryMove, BCOL, ELEV, MST, LDOOR, FLOORS, updateFloors, inCore, inCar, scene, BY, EXT, LOBBY, OUTSIDE, BASEMENT, FRONT_DOOR, updateLevel, talk, IDLE_SPOTS, blocked, freeStand, player, stations, setPaused, nextStation, IS_IOS, CAN_LOCK, chat, openChat, snapshot, workers, monitors, whiteboard, camera, colliders, ROOMS, LAYOUT };

// ---------- PWA: offline-capable once loaded (network-first, so updates show up right away) ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
