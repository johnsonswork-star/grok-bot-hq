// Office cast character models (HQ #46): low-poly, iPad-friendly people that read as the show's characters.
// Each body part (torso, head, each arm, each leg) is ONE merged mesh with vertex colors, so 14 people cost ~7 draws each.
// Front of a person = -z (same as workers.js). Keyed by station id (stable bot ids), falls back by display name.
import * as THREE from './vendor/three.module.js';

const PI = Math.PI;
// ---------- the cast ----------
// top = shirt/sweater/dress body color; open = jacket/cardigan/vest color over `top` (shows a shirt panel down the front)
// tie, skirt (color) / dress (skirt = top), sleeves 'long'|'short', hair style + color, face extras, body shape, props.
export const LOOKS = {
  grok:     { who: 'Michael Scott',   skin: '#f0c4a0', hair: ['side', '#3a2a1e'], top: '#c6d8ee', open: '#2a2e38', tie: '#b3262e', pants: '#2a2e38', h: 1.0, belly: 1.05, props: ['bossMug'] },
  inbox:    { who: 'Pam Beesly',      skin: '#f3cfb3', hair: ['long', '#8a4a2b', { len: 0.3, bangs: 1 }], top: '#f4f1ea', open: '#e7a1b0', skirt: '#6d6158', legs: '#e8c2a6', h: 0.95, lips: '#b5586a' },
  cos:      { who: 'Jim Halpert',     skin: '#f1c9a5', hair: ['floppy', '#5c3b22'], top: '#a9c0d8', tie: '#34445e', pants: '#3a3d44', h: 1.08, slim: 0.92 },
  assist:   { who: 'Dwight Schrute',  skin: '#f2cfae', hair: ['center', '#4a3220'], top: '#d1ad4f', sleeves: 'short', tie: '#5a3b1d', pants: '#4b3d2e', h: 1.04, glasses: '#2a2a2a', props: ['pen', 'pager'] },
  icons:    { who: 'Andy Bernard',    skin: '#f3cfb0', hair: ['side', '#8c6a3e'], top: '#f4f1ea', open: '#b31b1b', sweater: true, tie: '#1d3f8f', pants: '#c4ab7c', h: 1.0 },
  onpad:    { who: 'Phyllis Vance',   skin: '#f2cdb4', hair: ['curly', '#a7714f'], top: '#b9a1d4', skirt: '#5b5468', legs: '#e6c1a7', h: 0.93, belly: 1.25, wide: 1.18, lips: '#b5586a' },
  builder:  { who: 'Stanley Hudson',  skin: '#6b4430', hair: ['fringe', '#bdb8b0'], top: '#f1efe8', open: '#6a5643', vest: true, tie: '#7a2335', pants: '#3a3530', h: 1.0, belly: 1.35, wide: 1.2, glasses: '#3a2a20', mustache: '#cfcac0' },
  faith:    { who: 'Angela Martin',   skin: '#f6dcc6', hair: ['bun', '#e6d39a'], top: '#f6f3ec', open: '#e8dcb2', skirt: '#33343f', legs: '#d9c3b3', h: 0.88, slim: 0.9, lips: '#a8505c', props: ['catPin'] },
  broker:   { who: 'Oscar Martinez',  skin: '#b9855f', hair: ['short', '#161210'], top: '#a99fd2', tie: '#3c2f6b', pants: '#474b55', h: 1.0, beard: '#1e1814' },
  conn:     { who: 'Kevin Malone',    skin: '#f0c7a4', hair: ['receding', '#7a5a3c'], top: '#ecebe4', open: '#8c8452', sweater: true, pants: '#3e3a33', h: 1.04, belly: 1.5, wide: 1.3 },
  review:   { who: 'Creed Bratton',   skin: '#eecbb0', hair: ['messy', '#c9c6c0'], top: '#55606b', pants: '#2c2f33', h: 0.98, slim: 0.92 },
  kids:     { who: 'Meredith Palmer', skin: '#f0c9ad', hair: ['bob', '#a63a1c'], top: '#2c8a86', skirt: '#2f2f36', legs: '#e3bea2', h: 0.93, lips: '#a33a4a' },
  designer: { who: 'Kelly Kapoor',    skin: '#a8714f', hair: ['long', '#120d0b', { len: 0.42 }], top: '#e8408f', dress: true, legs: '#9a6648', h: 0.9, slim: 0.9, lips: '#c2335f', props: ['earrings'] },
  profile:  { who: 'Toby Flenderson', skin: '#efc9aa', hair: ['thin', '#6a5c4e'], top: '#a9bdd6', open: '#b9a888', sweater: true, pants: '#5f5a52', h: 1.0, stubble: '#8a7a6a', slump: 0.12 },
};
const BY_NAME = Object.fromEntries(Object.values(LOOKS).map(l => [l.who, l]));
export function lookFor(st) { return LOOKS[st.id] || BY_NAME[st.name] || { who: st.name, skin: '#f1c9a5', hair: ['short', '#3a2a1e'], top: st.color, pants: '#2f3640' }; }

// ---------- merged-part builder ----------
const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
class Part {
  constructor() { this.items = []; }
  add(geo, color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) { this.items.push({ geo, color, p, r, s }); return this; }
  mesh(shadow = false) {
    const pos = [], nor = [], col = [];
    const c = new THREE.Color();
    for (const it of this.items) {
      let g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
      _q.setFromEuler(_e.set(it.r[0], it.r[1], it.r[2])); _m.compose(_v.set(...it.p), _q, _s.set(...it.s));
      g.applyMatrix4(_m);
      c.set(it.color);
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      for (let k = 0; k < P.length; k++) { pos.push(P[k]); nor.push(N[k]); }
      for (let k = 0; k < P.length / 3; k++) col.push(c.r, c.g, c.b);
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, charMat); m.castShadow = shadow; return m;
  }
}
// shared primitive geometry
const SPH = (r, w = 10, h = 8, ps = 0, pl = PI * 2, ts = 0, tl = PI) => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
const BOX = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const CYL = (a, b, h, n = 10, open = false) => new THREE.CylinderGeometry(a, b, h, n, 1, open);
const G = {
  head: SPH(0.12, 12, 10), eye: SPH(0.015, 6, 4), ear: SPH(0.026, 6, 4), hand: SPH(0.046, 8, 6),
  brow: BOX(0.045, 0.01, 0.012), nose: BOX(0.026, 0.045, 0.03), mouth: BOX(0.048, 0.009, 0.01),
  lens: new THREE.TorusGeometry(0.029, 0.0045, 5, 12), bridge: BOX(0.026, 0.005, 0.005), temple: BOX(0.005, 0.005, 0.11),
  neck: CYL(0.05, 0.055, 0.14, 8), shoulders: SPH(0.17, 12, 6), belly: SPH(0.16, 12, 8), hips: CYL(0.15, 0.15, 0.12, 10),
  panel: BOX(0.12, 0.36, 0.02), tie: BOX(0.045, 0.32, 0.016), knot: BOX(0.05, 0.04, 0.02), collar: CYL(0.068, 0.072, 0.045, 10, true),
  skirt: CYL(0.165, 0.235, 0.46, 12), shoe: BOX(0.125, 0.075, 0.22), leg: BOX(0.125, 0.76, 0.135), belt: CYL(0.155, 0.155, 0.04, 10),
  sleeve: BOX(0.1, 0.52, 0.11), sleeveShort: BOX(0.11, 0.2, 0.12), forearm: BOX(0.075, 0.34, 0.085),
  fringeBox: BOX(0.2, 0.045, 0.07), tuft: SPH(0.045, 6, 4), curl: SPH(0.052, 7, 5), bun: SPH(0.058, 8, 6),
  cap: f => SPH(0.129, 14, 8, 0, PI * 2, 0, PI * f), back: (a, b) => SPH(0.128, 12, 6, 0, PI, PI * a, PI * (b - a)),
  beard: SPH(0.124, 12, 6, PI, PI, PI * 0.6, PI * 0.3), stache: BOX(0.075, 0.02, 0.022),
  tiny: BOX(0.03, 0.04, 0.012), pager: BOX(0.05, 0.07, 0.025), pen: BOX(0.012, 0.06, 0.012), earring: SPH(0.012, 6, 4),
};
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

function addHair(head, look) {
  const [style, hc, o = {}] = look.hair;
  const dk = shade(hc, 0.8);
  switch (style) {
    case 'side': // Michael / Andy: short, combed with a side part
      head.add(G.cap(0.42), hc, [0, 0.012, 0.004], [0.32, 0, 0]).add(G.back(0.3, 0.6), hc, [0, 0.005, 0]);
      head.add(G.fringeBox, hc, [0.02, 0.09, -0.07], [0.35, 0, -0.18], [0.85, 1, 1]); break;
    case 'floppy': // Jim: shaggy, longer on top, swept across the forehead
      head.add(G.cap(0.46), hc, [0, 0.018, 0], [0.22, 0, 0], [1.04, 1.08, 1.04]).add(G.back(0.28, 0.66), hc, [0, 0, 0.004], [0, 0, 0], [1.03, 1, 1.03]);
      head.add(G.fringeBox, hc, [-0.015, 0.085, -0.092], [0.6, 0, 0.22], [1.05, 1.4, 1]).add(G.tuft, dk, [0.05, 0.12, -0.04]).add(G.tuft, hc, [-0.06, 0.12, 0.0]); break;
    case 'center': // Dwight: center part, flat sides
      head.add(G.cap(0.44), hc, [0, 0.01, 0.006], [0.28, 0, 0]).add(G.back(0.28, 0.62), hc);
      head.add(G.fringeBox, hc, [-0.05, 0.085, -0.088], [0.45, 0, 0.32], [0.55, 1, 1]).add(G.fringeBox, hc, [0.05, 0.085, -0.088], [0.45, 0, -0.32], [0.55, 1, 1]);
      head.add(BOX(0.02, 0.07, 0.05), hc, [-0.118, -0.0, -0.03]).add(BOX(0.02, 0.07, 0.05), hc, [0.118, 0, -0.03]); break; // sideburns
    case 'short': // Oscar: neat, close-cropped
      head.add(G.cap(0.4), hc, [0, 0.008, 0.006], [0.36, 0, 0]).add(G.back(0.3, 0.58), hc, [0, 0, 0], [0, 0, 0], [0.99, 1, 0.99]); break;
    case 'receding': // Kevin: short and thin up top
      head.add(G.cap(0.34), hc, [0, 0.006, 0.02], [0.62, 0, 0], [0.98, 0.98, 0.98]).add(G.back(0.32, 0.58), hc, [0, 0, 0], [0, 0, 0], [0.99, 1, 0.99]); break;
    case 'thin': // Toby: thinning, short
      head.add(G.cap(0.36), hc, [0, 0.005, 0.012], [0.45, 0, 0], [0.99, 0.99, 0.99]).add(G.back(0.3, 0.6), hc); break;
    case 'fringe': // Stanley: bald on top, short gray band around the back
      head.add(G.back(0.42, 0.6), hc, [0, -0.005, 0], [0, 0, 0], [1.0, 1, 1.0]); break;
    case 'messy': // Creed: wispy gray, sticking up
      head.add(G.cap(0.4), hc, [0, 0.01, 0.012], [0.4, 0, 0]).add(G.back(0.3, 0.62), hc);
      for (const [x, y, z] of [[-0.07, 0.11, -0.02], [0.06, 0.12, 0.02], [0, 0.13, 0.05], [-0.09, 0.07, 0.07], [0.1, 0.07, 0.06]]) head.add(G.tuft, hc, [x, y, z], [0, 0, 0], [0.8, 0.7, 0.8]); break;
    case 'long': { // Pam / Kelly: long, down past the shoulders
      const len = o.len || 0.3;
      head.add(G.cap(0.5), hc, [0, 0.012, 0.004], [0.18, 0, 0], [1.04, 1.04, 1.06]).add(G.back(0.25, 0.75), hc, [0, 0, 0.004], [0, 0, 0], [1.06, 1.02, 1.06]);
      head.add(BOX(0.25, len, 0.08), hc, [0, -len / 2 + 0.02, 0.075]);
      head.add(BOX(0.05, len * 0.8, 0.07), hc, [-0.115, -len * 0.4 + 0.02, 0.0]).add(BOX(0.05, len * 0.8, 0.07), hc, [0.115, -len * 0.4 + 0.02, 0.0]);
      if (o.bangs) head.add(G.fringeBox, hc, [0, 0.085, -0.095], [0.55, 0, 0], [1.0, 1.1, 1]);
      break; }
    case 'bob': // Meredith: red, chin length, a bit messy
      head.add(G.cap(0.5), hc, [0, 0.012, 0], [0.18, 0, 0], [1.06, 1.05, 1.07]).add(G.back(0.25, 0.8), hc, [0, -0.005, 0.005], [0, 0, 0], [1.1, 1.0, 1.1]);
      head.add(BOX(0.06, 0.16, 0.09), hc, [-0.122, -0.04, -0.01], [0, 0, 0.1]).add(BOX(0.06, 0.16, 0.09), hc, [0.122, -0.04, -0.01], [0, 0, -0.1]); break;
    case 'bun': // Angela: scraped back into a tight bun
      head.add(G.cap(0.52), hc, [0, 0.006, 0.004], [0.16, 0, 0], [1.0, 1.0, 1.02]).add(G.back(0.25, 0.62), hc).add(G.bun, hc, [0, 0.07, 0.12]); break;
    case 'curly': // Phyllis: short and curly
      head.add(G.cap(0.5), hc, [0, 0.015, 0], [0.18, 0, 0], [1.06, 1.06, 1.06]);
      for (let k = 0; k < 9; k++) { const a = PI * 0.15 + k / 8 * PI * 1.7; head.add(G.curl, k % 2 ? hc : dk, [Math.cos(a) * 0.12, 0.03 + (k % 3) * 0.02, Math.sin(a) * 0.12]); }
      head.add(G.curl, hc, [0, 0.12, 0.02]).add(G.curl, dk, [-0.05, 0.11, -0.05]).add(G.curl, hc, [0.05, 0.11, -0.05]); break;
  }
  return style;
}

function addFace(head, look) {
  const sk = look.skin, brow = look.hair[0] === 'fringe' ? '#222' : shade(look.hair[1], 0.85);
  head.add(G.head, sk, [0, 0, 0], [0, 0, 0], [1, 1.08, 1]);
  head.add(G.ear, sk, [-0.12, 0, 0.005], [0, 0, 0], [0.6, 1, 1]).add(G.ear, sk, [0.12, 0, 0.005], [0, 0, 0], [0.6, 1, 1]);
  head.add(G.eye, '#1a1714', [-0.043, 0.012, -0.108]).add(G.eye, '#1a1714', [0.043, 0.012, -0.108]);
  head.add(G.brow, brow, [-0.043, 0.042, -0.112], [0, 0, 0.08]).add(G.brow, brow, [0.043, 0.042, -0.112], [0, 0, -0.08]);
  head.add(G.nose, shade(sk, 0.93), [0, -0.012, -0.122]);
  head.add(G.mouth, look.lips || shade(sk, 0.6), [0, -0.055, -0.111]);
  if (look.glasses) { const gc = look.glasses;
    head.add(G.lens, gc, [-0.043, 0.012, -0.124]).add(G.lens, gc, [0.043, 0.012, -0.124]).add(G.bridge, gc, [0, 0.016, -0.126])
      .add(G.temple, gc, [-0.118, 0.016, -0.07]).add(G.temple, gc, [0.118, 0.016, -0.07]); }
  if (look.mustache) head.add(G.stache, look.mustache, [0, -0.036, -0.118]);
  if (look.beard) head.add(G.beard, look.beard, [0, 0, 0], [0, 0, 0], [1.03, 1.06, 1.05]).add(G.stache, look.beard, [0, -0.035, -0.118]);
  if (look.stubble) head.add(G.beard, look.stubble, [0, 0, 0], [0, 0, 0], [1.0, 1.06, 1.01]);
  if (look.props?.includes('earrings')) head.add(G.earring, '#e3c25a', [-0.122, -0.035, -0.0]).add(G.earring, '#e3c25a', [0.122, -0.035, -0.0]);
}

let bossTex = null;
function bossMug() {
  if (!bossTex) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#111'; g.font = '900 17px Arial'; g.textAlign = 'center';
    g.fillText("WORLD'S", 64, 20); g.fillText('BEST', 64, 39); g.fillText('BOSS', 64, 58);
    bossTex = new THREE.CanvasTexture(c); bossTex.colorSpace = THREE.SRGBColorSpace;
  }
  const grp = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ map: bossTex, roughness: 0.4 }), plain = new THREE.MeshStandardMaterial({ color: '#f6f6f2', roughness: 0.4 });
  const body = new THREE.Mesh(CYL(0.042, 0.038, 0.105, 12), [side, plain, plain]); body.rotation.y = PI; grp.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 5, 10), plain); handle.position.set(0.045, 0, 0); grp.add(handle);
  return grp;
}

// Returns the same rig shape workers.js has always used: { root, body, headG, legL, legR, armL, armR, cup, phone, extras }
export function buildCharacter(st, { cupGeo, phoneGeo, cupMat, phoneMat } = {}) {
  const L = lookFor(st);
  const wide = L.wide || L.slim || 1, belly = L.belly || 1, hip = 0.8;
  const root = new THREE.Group(); root.name = 'char:' + st.id;
  const body = new THREE.Group(); root.add(body);
  const top = L.dress ? L.top : L.top, outer = L.open || L.top;
  const pants = L.pants || L.legs || '#2f3640';

  // torso (+ neck, shoulders, belly, collar, tie, skirt/hips)
  const T = new Part();
  T.add(CYL(0.17, 0.152, 0.56, 12), outer, [0, hip + 0.3, 0], [0, 0, 0], [wide, 1, wide * 0.82]);
  T.add(G.shoulders, outer, [0, hip + 0.54, 0], [0, 0, 0], [wide * 1.08, 0.42, wide * 0.84]);
  if (belly > 1.01) T.add(G.belly, outer, [0, hip + 0.19, -0.02 - (belly - 1) * 0.08], [0, 0, 0], [wide * 0.9, 0.8 + (belly - 1) * 0.3, 0.62 + (belly - 1) * 0.45]);
  T.add(G.neck, L.skin, [0, hip + 0.62, 0]);
  const front = -0.142 * wide * (belly > 1.2 ? 1.08 : 1) - 0.012;
  const collarCol = L.open || L.tie ? top : outer;
  if (!L.dress && !L.skirt || L.open) T.add(G.collar, collarCol, [0, hip + 0.59, 0]);
  if (L.open) { // jacket / cardigan / vest: shirt panel down the front
    const pw = L.vest ? 0.1 : L.sweater ? 0.075 : 0.11;
    T.add(BOX(pw, L.sweater ? 0.06 : 0.34, 0.02), top, [0, hip + (L.sweater ? 0.545 : 0.39), front], [-0.06, 0, 0]);
    if (!L.vest && !L.sweater) { // lapels
      T.add(BOX(0.05, 0.26, 0.022), shade(outer, 0.8), [-0.055, hip + 0.42, front - 0.004], [-0.06, 0, -0.25]).add(BOX(0.05, 0.26, 0.022), shade(outer, 0.8), [0.055, hip + 0.42, front - 0.004], [-0.06, 0, 0.25]);
      T.add(BOX(0.02, 0.02, 0.01), '#d9d4c4', [0, hip + 0.18, front - 0.006]); // button
    }
  }
  if (L.tie) T.add(G.knot, L.tie, [0, hip + 0.555, front - 0.008], [-0.1, 0, 0]).add(G.tie, L.tie, [0, hip + 0.38, front - 0.012], [-0.06, 0, 0]);
  if (L.skirt || L.dress) T.add(G.skirt, L.dress ? L.top : L.skirt, [0, hip - 0.16, 0], [0, 0, 0], [wide, 1, wide * 0.85]);
  else { T.add(G.hips, pants, [0, hip + 0.01, 0], [0, 0, 0], [wide, 1, wide * 0.85]).add(G.belt, '#2a221c', [0, hip + 0.06, 0], [0, 0, 0], [wide * 1.02, 1, wide * 0.9]); }
  if (L.props?.includes('pen')) T.add(G.pen, '#2b56b8', [-0.075, hip + 0.47, front - 0.006]).add(G.pen, '#c22', [-0.06, hip + 0.47, front - 0.006]);
  if (L.props?.includes('pager')) T.add(G.pager, '#1b1b1b', [0.16 * wide, hip + 0.03, -0.03]);
  if (L.props?.includes('catPin')) T.add(G.tiny, '#c9b06b', [-0.07, hip + 0.48, front - 0.008]);
  if (L.vest) T.add(BOX(0.02, 0.02, 0.01), shade(outer, 0.6), [0, hip + 0.22, front - 0.004]);
  body.add(T.mesh(true));

  // head
  const neck = new THREE.Group(); neck.position.y = hip + 0.72; neck.rotation.x = -(L.slump || 0); body.add(neck);
  const headG = new THREE.Group(); neck.add(headG);
  const H = new Part(); addFace(H, L); addHair(H, L);
  headG.add(H.mesh(true));

  // arms (Group so workers.js can rotate + parent the cup/phone to it)
  const sx = 0.22 * wide + (belly > 1.2 ? 0.02 : 0);
  const mkArm = side => {
    const g = new THREE.Group(); g.position.set(side * sx, hip + 0.54, 0);
    const A = new Part();
    const sleeveCol = L.open && !L.vest ? outer : top;
    if (L.sleeves === 'short') A.add(G.sleeveShort, sleeveCol, [0, -0.09, 0]).add(G.forearm, L.skin, [0, -0.35, 0]);
    else A.add(G.sleeve, sleeveCol, [0, -0.26, 0]).add(BOX(0.085, 0.04, 0.095), L.open && !L.vest && !L.sweater ? top : shade(sleeveCol, 0.9), [0, -0.52, 0]); // cuff
    A.add(G.hand, L.skin, [0, -0.575, -0.005], [0, 0, 0], [0.85, 1.05, 1]);
    g.add(A.mesh(false)); body.add(g); return g;
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // legs
  const legCol = L.skirt || L.dress ? (L.legs || L.skin) : pants;
  const shoeCol = L.skirt || L.dress ? '#2a1d18' : L.pants === '#c4ab7c' ? '#5a3a22' : '#1e1b19';
  const mkLeg = side => {
    const g = new THREE.Group(); g.position.set(side * 0.085 * wide, hip, 0);
    const Lg = new Part();
    Lg.add(L.skirt || L.dress ? BOX(0.1, 0.76, 0.11) : G.leg, legCol, [0, -0.38, 0]).add(G.shoe, shoeCol, [0, -0.765, -0.035]);
    g.add(Lg.mesh(false)); body.add(g); return g;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // hand props (workers.js shows/hides cup + phone)
  const cup = new THREE.Mesh(cupGeo || CYL(0.035, 0.03, 0.09, 8), cupMat || new THREE.MeshStandardMaterial({ color: '#f2f2f0' })); cup.position.set(0, -0.6, -0.04); cup.visible = false; armR.add(cup);
  const phone = new THREE.Mesh(phoneGeo || BOX(0.07, 0.13, 0.012), phoneMat || new THREE.MeshStandardMaterial({ color: '#16181c' })); phone.position.set(0, -0.6, -0.05); phone.rotation.x = PI / 2; phone.visible = false; armR.add(phone);
  const extras = [];
  if (L.props?.includes('bossMug')) { const m = bossMug(); m.position.set(0, -0.6, -0.05); armL.add(m); extras.push({ obj: m, standOnly: true }); }

  root.scale.setScalar(L.h || 1);
  root.userData.look = L;
  return { root, body, headG, legL, legR, armL, armR, cup, phone, extras, look: L };
}
