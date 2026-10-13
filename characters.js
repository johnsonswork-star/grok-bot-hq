// Office cast character models (HQ #46, upgraded HQ #70): smooth, rounded, iPad-friendly people that read as the show's characters.
// HQ #70: lathe-turned torsos, capsule limbs with real elbows + knees, mitten hands with thumbs, eyes with whites,
// per-person expression (mouth/brows), smoother hair. Each body part is still ONE merged vertex-colored mesh (cheap draws).
// Front of a person = -z (same as workers.js). Keyed by station id (stable bot ids), falls back by display name.
import * as THREE from './vendor/three.module.js';

const PI = Math.PI;
// ---------- the cast ----------
// top = shirt/sweater/dress body color; open = jacket/cardigan/vest color over `top` (shows a shirt panel down the front)
// tie, skirt (color) / dress (skirt = top), sleeves 'long'|'short', hair style + color, face extras, body shape, props.
// mood = mouth/brow expression: grin | smile | smirk | flat | stern | sad | sly | blank
export const LOOKS = {
  grok:     { who: 'Michael Scott', face: { jaw: 1.05, chin: 1.2 },   skin: '#f0c4a0', hair: ['side', '#3a2a1e'], top: '#c6d8ee', open: '#2a2e38', tie: '#b3262e', pants: '#2a2e38', h: 1.0, belly: 1.05, mood: 'grin', props: ['bossMug'], idle: 'boss' },
  inbox:    { who: 'Pam Beesly', face: { jaw: 0.9, chin: 1.0, nose: 0.9 },      skin: '#f3cfb3', hair: ['long', '#8a4a2b', { len: 0.3, bangs: 1, curl: 1 }], top: '#f4f1ea', open: '#e7a1b0', skirt: '#6d6158', legs: '#e8c2a6', h: 0.95, lips: '#b5586a', mood: 'smile', cheeks: 1, fem: 1 },
  cos:      { who: 'Jim Halpert', face: { jaw: 1.0, chin: 1.1, nose: 1.05 },     skin: '#f1c9a5', hair: ['floppy', '#5c3b22'], top: '#a9c0d8', tie: '#34445e', pants: '#3a3d44', h: 1.08, slim: 0.92, mood: 'smirk', idle: 'lean' },
  assist:   { who: 'Dwight Schrute', face: { jaw: 1.18, chin: 0.8, nose: 1.1 },  skin: '#f2cfae', hair: ['center', '#4a3220'], top: '#d1ad4f', sleeves: 'short', tie: '#5a3b1d', pants: '#4b3d2e', h: 1.04, glasses: '#2a2a2a', mood: 'stern', props: ['pen', 'pager'], idle: 'upright' },
  icons:    { who: 'Andy Bernard', face: { jaw: 1.12, chin: 1.3 },    skin: '#f3cfb0', hair: ['side', '#8c6a3e'], top: '#f4f1ea', open: '#b31b1b', sweater: true, tie: '#1d3f8f', pants: '#c4ab7c', h: 1.0, mood: 'grin' },
  onpad:    { who: 'Phyllis Vance', face: { jaw: 1.2, chin: 0.6 },   skin: '#f2cdb4', hair: ['curly', '#a7714f'], top: '#b9a1d4', skirt: '#5b5468', legs: '#e6c1a7', h: 0.93, belly: 1.25, wide: 1.18, lips: '#b5586a', mood: 'smile', cheeks: 1, fem: 1, props: ['beads'] },
  builder:  { who: 'Stanley Hudson', face: { jaw: 1.25, chin: 0.7, nose: 1.2 },  skin: '#6b4430', hair: ['fringe', '#bdb8b0'], top: '#f1efe8', open: '#6a5643', vest: true, tie: '#7a2335', pants: '#3a3530', h: 1.0, belly: 1.35, wide: 1.2, glasses: '#3a2a20', mustache: '#cfcac0', mood: 'flat', idle: 'lean' },
  faith:    { who: 'Angela Martin', face: { jaw: 0.8, chin: 1.3, nose: 0.85 },   skin: '#f6dcc6', hair: ['bun', '#e6d39a'], top: '#f6f3ec', open: '#e8dcb2', skirt: '#33343f', legs: '#d9c3b3', h: 0.88, slim: 0.9, lips: '#a8505c', mood: 'stern', fem: 1, props: ['catPin'], idle: 'upright' },
  broker:   { who: 'Oscar Martinez', face: { jaw: 1.1, chin: 1 },  skin: '#b9855f', hair: ['short', '#161210'], top: '#a99fd2', tie: '#3c2f6b', pants: '#474b55', h: 1.0, beard: '#1e1814', mood: 'sly' },
  conn:     { who: 'Kevin Malone', face: { jaw: 1.35, chin: 0.4, nose: 1.1 },    skin: '#f0c7a4', hair: ['receding', '#7a5a3c'], top: '#ecebe4', open: '#8c8452', sweater: true, pants: '#3e3a33', h: 1.04, belly: 1.5, wide: 1.3, mood: 'blank', idle: 'snack' },
  review:   { who: 'Creed Bratton', face: { jaw: 0.92, chin: 1.2, nose: 1.25 },   skin: '#eecbb0', hair: ['messy', '#c9c6c0'], top: '#55606b', pants: '#2c2f33', h: 0.98, slim: 0.92, mood: 'sly', wrinkles: 1 },
  kids:     { who: 'Meredith Palmer', face: { jaw: 1.0, chin: 0.9 }, skin: '#f0c9ad', hair: ['bob', '#a63a1c'], top: '#2c8a86', skirt: '#2f2f36', legs: '#e3bea2', h: 0.93, lips: '#a33a4a', mood: 'smirk', cheeks: 1, fem: 1, idle: 'lean' },
  designer: { who: 'Kelly Kapoor', face: { jaw: 0.85, chin: 1.1, nose: 0.85 },    skin: '#a8714f', hair: ['long', '#120d0b', { len: 0.42 }], top: '#e8408f', dress: true, legs: '#9a6648', h: 0.9, slim: 0.9, lips: '#c2335f', mood: 'smile', lashes: 1, fem: 1, props: ['earrings'], idle: 'phone' },
  profile:  { who: 'Toby Flenderson', face: { jaw: 0.95, chin: 0.8 }, skin: '#efc9aa', hair: ['thin', '#6a5c4e'], top: '#a9bdd6', open: '#b9a888', sweater: true, pants: '#5f5a52', h: 1.0, stubble: '#8a7a6a', slump: 0.12, mood: 'sad', idle: 'slump' },
  darryl:   { who: 'Darryl Philbin', face: { jaw: 1.15, chin: 1 },  skin: '#5e3c2a', hair: ['short', '#151110'], top: '#4f6f95', sleeves: 'short', pants: '#2f3542', h: 1.07, beard: '#1a1412', mood: 'smirk', idle: 'upright' }, // HQ #79 warehouse foreman (static set dressing)
};
const BY_NAME = Object.fromEntries(Object.values(LOOKS).map(l => [l.who, l]));
export function lookFor(st) { return LOOKS[st.id] || BY_NAME[st.name] || { who: st.name, skin: '#f1c9a5', hair: ['short', '#3a2a1e'], top: st.color, pants: '#2f3640', mood: 'smile' }; }

// ---------- merged-part builder ----------
// HQ #90: ONE shared PBR material for every merged part; per-vertex `surf` (roughness, metalness, sheen) lets skin, hair,
// eyes, fabric, leather shoes and metal buckles each read correctly without extra draw calls or materials.
const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
charMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 surf;\nvarying vec3 vSurf;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSurf;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
    .replace('#include <opaque_fragment>', `{ float fres = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);
      outgoingLight += diffuseColor.rgb * fres * vSurf.z * 0.22; // cloth sheen / skin rim
      outgoingLight += vec3(0.06, 0.012, 0.0) * diffuseColor.rgb * step(0.5, vSurf.z) * step(vSurf.z, 0.7); } // skin warmth (subsurface fake)
    #include <opaque_fragment>`);
};
charMat.customProgramCacheKey = () => 'char-hq90';
// surface presets [roughness, metalness, sheen]; sheen 0.6 marks skin for the warmth term
const SURF = { fabric: [0.86, 0, 0.45], skin: [0.52, 0, 0.6], hair: [0.42, 0, 0.3], eye: [0.08, 0, 0], leather: [0.32, 0, 0.1], metal: [0.28, 0.9, 0], plastic: [0.35, 0, 0] };
let SURF_BY = {}; // color hex -> preset, set per character in buildCharacter
const surfFor = hex => SURF_BY[new THREE.Color(hex).getHexString()] || SURF.fabric;
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
class Part {
  constructor() { this.items = []; }
  add(geo, color, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], surf) { this.items.push({ geo, color, p, r, s, surf }); return this; }
  mesh(shadow = false) {
    const pos = [], nor = [], col = [], srf = [];
    const c = new THREE.Color();
    for (const it of this.items) {
      let g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
      _q.setFromEuler(_e.set(it.r[0], it.r[1], it.r[2])); _m.compose(_v.set(...it.p), _q, _s.set(...it.s));
      g.applyMatrix4(_m);
      c.set(it.color);
      const P = g.attributes.position.array, N = g.attributes.normal.array;
      for (let k = 0; k < P.length; k++) { pos.push(P[k]); nor.push(N[k]); }
      const sf = it.surf || surfFor(it.color);
      for (let k = 0; k < P.length / 3; k++) { col.push(c.r, c.g, c.b); srf.push(sf[0], sf[1], sf[2]); }
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('surf', new THREE.Float32BufferAttribute(srf, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, charMat); m.castShadow = shadow; return m;
  }
}
// shared primitive geometry
const SPH = (r, w = 16, h = 12, ps = 0, pl = PI * 2, ts = 0, tl = PI) => new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
const BOX = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const CYL = (a, b, h, n = 14, open = false) => new THREE.CylinderGeometry(a, b, h, n, 1, open);
const CAP = (r, len, cs = 4, rs = 12) => new THREE.CapsuleGeometry(r, len, cs, rs);
const CAPX = (r, len, cs = 3, rs = 10) => CAP(r, len, cs, rs).rotateZ(PI / 2); // lying along x
const CAPZ = (r, len, cs = 3, rs = 10) => CAP(r, len, cs, rs).rotateX(PI / 2); // lying along z
const ARC = (r, tube, arc) => new THREE.TorusGeometry(r, tube, 5, 14, arc).rotateZ(-PI / 2 - arc / 2); // U-shape, low point at (0,-r)
const LATHE = (pts, n = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
// HQ #90b: sculpted head. Sphere pushed into a skull: tapered jaw, defined chin, cheekbones, flatter temples, rounder occiput.
function headGeo(o = {}) {
  const g = SPH(0.12, 32, 26), P = g.attributes.position, r = 0.12, jaw = o.jaw ?? 1, chin = o.chin ?? 1;
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i); const ny = y / r, fz = Math.max(0, -z / r), bz = Math.max(0, z / r);
    const lo = Math.max(0, -ny);
    x *= 1 - 0.26 * Math.pow(lo, 1.4) * (2 - jaw);                       // jaw taper (jaw>1 = squarer)
    if (ny < -0.35) z -= fz * 0.018 * chin * Math.min(1, (-ny - 0.35) / 0.4); // chin forward
    if (ny > -0.35 && ny < 0.15) x *= 1 + 0.05 * fz * (1 - Math.abs(ny + 0.1) / 0.25 > 0 ? 1 - Math.abs(ny + 0.1) / 0.25 : 0); // cheekbones
    if (Math.abs(x / r) > 0.75 && ny > -0.1) x *= 0.96;                 // flatter temples
    z += bz * 0.012 * Math.max(0, 1 - Math.abs(ny - 0.15) / 0.6);         // occiput
    if (fz > 0.6 && ny > 0.2 && ny < 0.6) z += 0.006;                     // brow ridge/eye socket
    P.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals(); return g;
}
// HQ #90b: hair shells get strand clumps (radial ridges) so hair reads as hair, not a helmet
function clump(g, n = 18, amp = 0.05, seed = 0) {
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), l = Math.hypot(x, y, z) || 1;
    const k = 1 + amp * (0.5 + 0.5 * Math.sin(a * n + seed + y * 40)) * Math.min(1, (0.13 - y) * 8 + 0.3); P.setXYZ(i, x * k, y * (1 + amp * 0.3), z * k); }
  g.computeVertexNormals(); return g;
}
const G = {
  head: SPH(0.12, 28, 20), ear: SPH(0.026, 10, 8), hand: SPH(0.042, 12, 10), thumb: CAP(0.013, 0.03, 2, 6),
  eyeW: SPH(0.021, 12, 10), pupil: SPH(0.0115, 10, 8), shine: SPH(0.004, 4, 3), lid: SPH(0.023, 12, 6, 0, PI * 2, 0, PI * 0.42),
  brow: CAPX(0.0065, 0.036, 2, 6), nose: SPH(0.021, 12, 10), nostril: SPH(0.009, 6, 4), cheek: SPH(0.024, 10, 8),
  lens: new THREE.TorusGeometry(0.029, 0.0045, 6, 18), bridge: BOX(0.026, 0.005, 0.005), temple: BOX(0.005, 0.005, 0.11),
  neck: CYL(0.05, 0.056, 0.16, 14), deltoid: SPH(0.047, 14, 10), belly: SPH(0.16, 20, 14),
  tie: BOX(0.042, 0.28, 0.014), tieTip: BOX(0.03, 0.03, 0.014), knot: SPH(0.024, 10, 8), collarTip: BOX(0.05, 0.022, 0.012),
  skirt: CYL(0.16, 0.24, 0.46, 22), dressTop: CYL(0.15, 0.165, 0.1, 22),
  thigh: CAP(0.066, 0.26, 4, 12), shin: CAP(0.054, 0.28, 4, 12), shoe: CAPZ(0.046, 0.12, 4, 12), ankle: CAP(0.04, 0.12, 3, 10),
  upper: CAP(0.046, 0.19, 4, 12), fore: CAP(0.04, 0.19, 4, 12), sleeveShort: CYL(0.062, 0.058, 0.14, 14), cuff: CYL(0.047, 0.047, 0.03, 12),
  fringe: CAPX(0.028, 0.15, 3, 8), tuft: SPH(0.045, 10, 8), curl: SPH(0.052, 10, 8), bun: SPH(0.058, 14, 10),
  cap: f => clump(SPH(0.129, 40, 16, 0, PI * 2, 0, PI * f), 22, 0.035), back: (a, b) => clump(SPH(0.128, 32, 12, 0, PI, PI * a, PI * (b - a)), 16, 0.04, 1),
  beard: SPH(0.124, 22, 10, PI, PI, PI * 0.6, PI * 0.3), stache: CAPX(0.012, 0.055, 2, 8),
  tiny: BOX(0.03, 0.04, 0.012), pager: BOX(0.05, 0.07, 0.025), pen: CYL(0.006, 0.006, 0.06, 6), earring: SPH(0.012, 8, 6), bead: SPH(0.011, 6, 4),
  finger: CAP(0.0105, 0.042, 2, 6), sole: BOX(0.1, 0.018, 0.2), lace: BOX(0.04, 0.006, 0.05), crease: BOX(0.004, 0.3, 0.004), shirtPocket: BOX(0.05, 0.055, 0.008),
  lidBlink: SPH(0.0225, 12, 8, 0, PI * 2, 0, PI * 0.62),
  button: CYL(0.009, 0.009, 0.006, 8).rotateX(PI / 2),
};
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };

function addHair(head, look) {
  const [style, hc, o = {}] = look.hair;
  const dk = shade(hc, 0.8), lt = shade(hc, 1.15);
  switch (style) {
    case 'side': // Michael / Andy: short, combed with a side part
      head.add(G.cap(0.42), hc, [0, 0.012, 0.004], [0.32, 0, 0]).add(G.back(0.3, 0.6), hc, [0, 0.005, 0]);
      head.add(G.fringe, hc, [0.02, 0.092, -0.07], [0.35, 0, -0.18], [0.85, 1, 1.2]).add(CAPZ(0.006, 0.09, 2, 4), dk, [-0.045, 0.118, -0.02], [0.2, 0, 0]); break; // part line
    case 'floppy': // Jim: shaggy, longer on top, swept across the forehead
      head.add(G.cap(0.46), hc, [0, 0.018, 0], [0.22, 0, 0], [1.04, 1.08, 1.04]).add(G.back(0.28, 0.66), hc, [0, 0, 0.004], [0, 0, 0], [1.03, 1, 1.03]);
      head.add(G.fringe, hc, [-0.015, 0.088, -0.092], [0.6, 0, 0.22], [1.05, 1.3, 1.3]).add(G.tuft, dk, [0.05, 0.12, -0.04]).add(G.tuft, hc, [-0.06, 0.12, 0.0]).add(G.tuft, lt, [0.0, 0.128, -0.07], [0, 0, 0], [1.2, 0.6, 0.8]); break;
    case 'center': // Dwight: center part, flat sides
      head.add(G.cap(0.44), hc, [0, 0.01, 0.006], [0.28, 0, 0]).add(G.back(0.28, 0.62), hc);
      head.add(G.fringe, hc, [-0.05, 0.088, -0.088], [0.45, 0, 0.32], [0.55, 1, 1.2]).add(G.fringe, hc, [0.05, 0.088, -0.088], [0.45, 0, -0.32], [0.55, 1, 1.2]);
      head.add(CAP(0.012, 0.05, 2, 6), hc, [-0.104, -0.0, -0.03], [0, 0, 0], [0.6, 1, 1]).add(CAP(0.012, 0.05, 2, 6), hc, [0.104, 0, -0.03], [0, 0, 0], [0.6, 1, 1]); break; // sideburns
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
      for (const [x, y, z] of [[-0.07, 0.11, -0.02], [0.06, 0.12, 0.02], [0, 0.13, 0.05], [-0.09, 0.07, 0.07], [0.1, 0.07, 0.06], [-0.11, 0.03, 0.03], [0.11, 0.03, 0.03]]) head.add(G.tuft, hc, [x, y, z], [0, 0, 0], [0.8, 0.7, 0.8]); break;
    case 'long': { // Pam / Kelly: long, down past the shoulders
      const len = o.len || 0.3;
      head.add(G.cap(0.5), hc, [0, 0.012, 0.004], [0.18, 0, 0], [1.04, 1.04, 1.06]).add(G.back(0.25, 0.75), hc, [0, 0, 0.004], [0, 0, 0], [1.06, 1.02, 1.06]);
      head.add(CAP(0.12, len, 4, 16), hc, [0, -len / 2 + 0.0, 0.06], [0.08, 0, 0], [1.08, 1, 0.42]); // back curtain, rounded
      head.add(CAP(0.032, len * 0.7, 3, 8), hc, [-0.112, -len * 0.36 + 0.01, -0.005], [0, 0, -0.06]).add(CAP(0.032, len * 0.7, 3, 8), hc, [0.112, -len * 0.36 + 0.01, -0.005], [0, 0, 0.06]);
      if (o.curl) head.add(G.curl, hc, [-0.1, -len + 0.06, 0.02], [0, 0, 0], [0.8, 0.7, 0.8]).add(G.curl, hc, [0.1, -len + 0.06, 0.02], [0, 0, 0], [0.8, 0.7, 0.8]);
      if (o.bangs) head.add(G.fringe, hc, [0, 0.088, -0.095], [0.55, 0, 0], [1.0, 1.1, 1.3]);
      else head.add(G.fringe, hc, [0.035, 0.09, -0.09], [0.5, 0, -0.35], [0.7, 1, 1.2]); // side-swept
      break; }
    case 'bob': // Meredith: red, chin length, a bit messy
      head.add(G.cap(0.5), hc, [0, 0.012, 0], [0.18, 0, 0], [1.06, 1.05, 1.07]).add(G.back(0.25, 0.8), hc, [0, -0.005, 0.005], [0, 0, 0], [1.1, 1.0, 1.1]);
      head.add(CAP(0.04, 0.1, 3, 8), hc, [-0.12, -0.045, -0.01], [0, 0, 0.12]).add(CAP(0.04, 0.1, 3, 8), hc, [0.12, -0.045, -0.01], [0, 0, -0.12]);
      head.add(G.tuft, dk, [0.07, 0.1, -0.05], [0, 0, 0], [0.8, 0.6, 0.8]); break;
    case 'bun': // Angela: scraped back into a tight bun
      head.add(G.cap(0.52), hc, [0, 0.006, 0.004], [0.16, 0, 0], [1.0, 1.0, 1.02]).add(G.back(0.25, 0.62), hc).add(G.bun, hc, [0, 0.07, 0.12]).add(new THREE.TorusGeometry(0.04, 0.008, 6, 14), dk, [0, 0.07, 0.085], [0.5, 0, 0]); break;
    case 'curly': // Phyllis: short and curly
      head.add(G.cap(0.5), hc, [0, 0.015, 0], [0.18, 0, 0], [1.06, 1.06, 1.06]);
      for (let k = 0; k < 11; k++) { const a = PI * 0.12 + k / 10 * PI * 1.76; head.add(G.curl, k % 2 ? hc : dk, [Math.cos(a) * 0.12, 0.03 + (k % 3) * 0.02, Math.sin(a) * 0.12]); }
      head.add(G.curl, hc, [0, 0.12, 0.02]).add(G.curl, dk, [-0.05, 0.11, -0.05]).add(G.curl, hc, [0.05, 0.11, -0.05]).add(G.curl, lt, [0, 0.1, -0.08], [0, 0, 0], [1, 0.8, 0.8]); break;
  }
  return style;
}

// ---------- face: eye whites + pupils, rounded nose, per-person mouth + brows ----------
function addFace(head, look) {
  const sk = look.skin, brow = look.hair[0] === 'fringe' ? '#2a2420' : shade(look.hair[1], 0.8), mood = look.mood || 'smile';
  const fz = -0.112; // eye plane (just proud of the head surface)
  head.add(headGeo(look.face), sk, [0, 0, 0], [0, 0, 0], [0.97, 1.1, 1.02]);
  for (const sx of [-1, 1]) { // ears: shell + rim + darker inner fold, set back and angled out
    head.add(G.ear, sk, [sx * 0.116, -0.004, 0.01], [0, sx * 0.35, 0], [0.5, 1.1, 0.85]);
    head.add(new THREE.TorusGeometry(0.02, 0.0045, 5, 12, PI * 1.3), sk, [sx * 0.124, 0.0, 0.008], [0, sx * PI / 2 + sx * 0.35, PI * 0.15]);
    head.add(SPH(0.012, 8, 6), shade(sk, 0.75), [sx * 0.125, -0.004, 0.004], [0, 0, 0], [0.4, 0.9, 0.7]);
  }
  head.add(SPH(0.03, 12, 8), sk, [0, -0.098, -0.085], [0, 0, 0], [1.1 * (look.face?.jaw || 1), 0.75, 0.8]); // chin pad
  // eyes
  const eyeX = 0.042, eyeY = 0.014;
  for (const sx of [-1, 1]) {
    head.add(G.eyeW, '#f7f4ef', [sx * eyeX, eyeY, fz], [0, 0, 0], [1.05, 0.95, 0.55]);
    head.add(G.pupil, look.eyes || '#2a1d14', [sx * eyeX, eyeY - 0.001, fz - 0.008], [0, 0, 0], [1, 1.05, 0.5]);
    head.add(G.shine, '#ffffff', [sx * eyeX + 0.004, eyeY + 0.004, fz - 0.0135], [0, 0, 0], [0.8, 0.8, 0.5]);
    head.add(G.lid, shade(sk, 0.92), [sx * eyeX, eyeY + 0.001, fz + 0.002], [mood === 'blank' || mood === 'sly' ? -0.55 : -0.25, 0, 0], [1.05, 1, 0.6]); // upper lid
    if (look.lashes) head.add(CAPX(0.003, 0.03, 2, 4), '#111', [sx * eyeX, eyeY + 0.016, fz - 0.008], [0, 0, sx * -0.12]);
  }
  // brows (angle sells the personality)
  const bAng = { stern: 0.32, sad: -0.3, sly: 0.12, smirk: 0.05, grin: -0.1, blank: -0.05, flat: 0.12, smile: -0.06 }[mood] ?? 0;
  const bY = 0.048 + (mood === 'grin' ? 0.006 : 0) + (mood === 'stern' ? -0.004 : 0);
  head.add(G.brow, brow, [-eyeX, bY + (mood === 'smirk' ? 0.006 : 0), fz - 0.01], [0, 0, -bAng], [1, look.fem ? 0.8 : 1.3, 1]);
  head.add(G.brow, brow, [eyeX, bY, fz - 0.01], [0, 0, bAng], [1, look.fem ? 0.8 : 1.3, 1]);
  // nose
  head.add(CAP(0.011 * (look.face?.nose || 1), 0.04, 2, 8), sk, [0, 0.0, -0.122], [-0.32, 0, 0], [1, 1, 0.9]); // nose bridge
  head.add(G.nose, shade(sk, 0.97), [0, -0.022, -0.126], [0, 0, 0], [0.68 * (look.face?.nose || 1), 0.8, 0.8]); // tip
  head.add(SPH(0.011, 8, 6), shade(sk, 0.94), [-0.015, -0.027, -0.117]).add(SPH(0.011, 8, 6), shade(sk, 0.94), [0.015, -0.027, -0.117]); // alae
  head.add(CAPX(0.006, 0.05, 2, 6), shade(sk, 0.85), [0, -0.068, -0.108], [0, 0, 0], [1, 1, 0.6]); // lower-lip shadow
  head.add(G.nostril, shade(sk, 0.85), [-0.01, -0.028, -0.119], [0, 0, 0], [0.8, 0.7, 0.8]).add(G.nostril, shade(sk, 0.85), [0.01, -0.028, -0.119], [0, 0, 0], [0.8, 0.7, 0.8]);
  // mouth
  const mc = look.lips || shade(sk, 0.55), my = -0.058, mz = -0.119;
  if (mood === 'grin') { // big Michael / Andy smile with teeth
    head.add(SPH(0.03, 14, 8, 0, PI * 2, PI * 0.5, PI * 0.5), '#f5f2ea', [0, my + 0.01, mz + 0.004], [0, 0, 0], [1.2, 0.75, 0.5]);
    head.add(ARC(0.032, 0.0055, PI * 0.75), mc, [0, my + 0.03, mz], [0, 0, 0], [1.1, 0.75, 1]);
  } else if (mood === 'smile') head.add(ARC(0.026, 0.005, PI * 0.6), mc, [0, my + 0.022, mz], [0, 0, 0], [1, 0.7, 1]);
  else if (mood === 'smirk') head.add(ARC(0.03, 0.0048, PI * 0.45), mc, [0.008, my + 0.026, mz], [0, 0, 0.32], [1, 0.6, 1]);
  else if (mood === 'sly') head.add(ARC(0.034, 0.0045, PI * 0.35), mc, [0.004, my + 0.03, mz], [0, 0, 0.18], [1, 0.5, 1]);
  else if (mood === 'sad') head.add(ARC(0.026, 0.0045, PI * 0.5), mc, [0, my - 0.02, mz], [0, 0, PI], [1, 0.45, 1]);
  else if (mood === 'stern') head.add(CAPX(0.0045, 0.034, 2, 6), mc, [0, my, mz], [0, 0, 0], [1, 1, 1]).add(ARC(0.02, 0.004, PI * 0.5), mc, [0, my - 0.016, mz], [0, 0, PI], [1.2, 0.3, 1]);
  else if (mood === 'blank') head.add(SPH(0.012, 10, 8), shade(mc, 0.7), [0, my, mz + 0.002], [0, 0, 0], [1.4, 0.9, 0.5]); // Kevin's little "o"
  else head.add(CAPX(0.0048, 0.04, 2, 6), mc, [0, my, mz]);
  if (look.cheeks) head.add(G.cheek, shade('#e88a8a', 1), [-0.07, -0.03, -0.092], [0, 0, 0], [1, 0.7, 0.3]).add(G.cheek, '#e88a8a', [0.07, -0.03, -0.092], [0, 0, 0], [1, 0.7, 0.3]);
  if (look.wrinkles) for (const sx of [-1, 1]) head.add(CAPX(0.0025, 0.02, 2, 4), shade(sk, 0.75), [sx * 0.07, 0.005, -0.094], [0, sx * 0.6, sx * 0.4]);
  if (look.glasses) { const gc = look.glasses;
    head.add(G.lens, gc, [-eyeX, eyeY, -0.124]).add(G.lens, gc, [eyeX, eyeY, -0.124]).add(G.bridge, gc, [0, eyeY + 0.004, -0.126])
      .add(G.temple, gc, [-0.11, eyeY + 0.004, -0.07]).add(G.temple, gc, [0.11, eyeY + 0.004, -0.07]); }
  if (look.mustache) head.add(G.stache, look.mustache, [0, -0.04, -0.118], [0, 0, 0], [1.1, 1.2, 1]);
  if (look.beard) head.add(G.beard, look.beard, [0, 0, 0], [0, 0, 0], [1.03, 1.06, 1.05]).add(G.stache, look.beard, [0, -0.039, -0.117]);
  if (look.stubble) head.add(G.beard, look.stubble, [0, 0, 0], [0, 0, 0], [1.0, 1.06, 1.01]);
  if (look.props?.includes('earrings')) head.add(G.earring, '#e3c25a', [-0.12, -0.035, -0.0]).add(G.earring, '#e3c25a', [0.12, -0.035, -0.0]);
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

// torso silhouette (radius by height above the hip line); women get a waist, everyone gets shoulders that slope into the neck
function torsoProfile(L) {
  const w = L.fem ? 0.88 : 1, ch = L.fem ? 0.97 : 1;
  return [[0.148, 0.02], [0.147, 0.1], [0.148 * w, 0.2], [0.16 * ch, 0.3], [0.172 * ch, 0.38], [0.178, 0.44], [0.172, 0.49], [0.15, 0.53], [0.11, 0.565], [0.06, 0.59], [0.045, 0.6]];
}
const rAt = (prof, y) => { for (let k = 1; k < prof.length; k++) if (y <= prof[k][1]) { const [r0, y0] = prof[k - 1], [r1, y1] = prof[k]; return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return prof[prof.length - 1][0]; };

// Rig: { root, body, spine, headG, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, cup, phone, extras, look }
// body = whole person (workers.js bobs/drops it), spine = upper body pivoting at the hips (lean / breathe / weight shift).
export function buildCharacter(st, { cupGeo, phoneGeo, cupMat, phoneMat } = {}) {
  const L = lookFor(st);
  const wide = L.wide || L.slim || 1, belly = L.belly || 1, hip = 0.8;
  const root = new THREE.Group(); root.name = 'char:' + st.id;
  const body = new THREE.Group(); root.add(body);
  const spine = new THREE.Group(); spine.position.y = hip; body.add(spine);
  const top = L.top, outer = L.open || L.top;
  const pants = L.pants || L.legs || '#2f3640';
  const xs = 1.06 * wide, zs = 0.74 * wide;
  const prof = torsoProfile(L);
  const shoeC = (L.skirt || L.dress) ? (L.dress ? '#1a1214' : '#2a1d18') : L.pants === '#c4ab7c' ? '#5a3a22' : '#1e1b19';
  SURF_BY = {}; const reg = (hex, sf) => { if (hex) SURF_BY[new THREE.Color(hex).getHexString()] = sf; };
  reg(L.hair[1], SURF.hair); reg(shade(L.hair[1], 0.8), SURF.hair); reg(shade(L.hair[1], 1.15), SURF.hair);
  reg(L.beard, SURF.hair); reg(L.mustache, SURF.hair); reg(L.stubble, SURF.hair);
  for (const k of [1, 0.96, 0.92, 0.85, 0.75]) reg(shade(L.skin, k), SURF.skin);
  reg(L.legs, SURF.skin); reg(L.lips, [0.35, 0, 0.6]); reg('#e88a8a', SURF.skin);
  reg('#f7f4ef', SURF.eye); reg('#ffffff', SURF.eye); reg(L.eyes || '#2a1d14', SURF.eye); reg('#f5f2ea', SURF.eye);
  reg(shoeC, SURF.leather); reg('#c8b070', SURF.metal); reg('#e3c25a', SURF.metal); reg('#c9b06b', SURF.metal); reg('#2a221c', SURF.leather);
  reg(L.glasses, SURF.plastic); reg('#1b1b1b', SURF.plastic); reg('#222', SURF.plastic);
  const front = y => -rAt(prof, y) * zs - 0.004 - (belly > 1.01 && y < 0.36 ? (belly - 1) * 0.11 * Math.max(0, 1 - Math.abs(y - 0.19) / 0.2) : 0);

  // ---- torso (spine-local: y=0 is the hip line) ----
  const T = new Part();
  T.add(LATHE(prof), outer, [0, 0, 0], [0, 0, 0], [xs, 1, zs]);
  if (belly > 1.01) T.add(G.belly, outer, [0, 0.19, -0.03 - (belly - 1) * 0.07], [0, 0, 0], [xs * 0.88, 0.8 + (belly - 1) * 0.3, 0.6 + (belly - 1) * 0.42]);
  T.add(G.neck, L.skin, [0, 0.63, 0], [0.12, 0, 0], [1, 1, 0.95]);
  T.add(SPH(0.14, 20, 10, 0, PI * 2, 0, PI * 0.5), outer, [0, 0.5, 0.01], [0, 0, 0], [xs * 1.18, 0.55, zs * 0.95]); // trapezius / shoulder slope
  T.add(SPH(0.04, 10, 8), shade(L.skin, 0.92), [0, 0.58, -0.05], [0, 0, 0], [1, 0.6, 0.5]); // throat/collarbone notch
  // pelvis / hips (skirts cover this)
  if (!(L.skirt || L.dress)) {
    T.add(LATHE([[0.0, -0.1], [0.1, -0.095], [0.142, -0.05], [0.15, 0.0], [0.15, 0.06], [0.0, 0.06]], 18), pants, [0, 0, 0], [0, 0, 0], [xs, 1, zs * 1.05]);
    T.add(CYL(0.153, 0.153, 0.04, 18, true), '#2a221c', [0, 0.05, 0], [0, 0, 0], [xs, 1, zs * 1.08 + (belly > 1.2 ? 0.05 : 0)]); // belt
    T.add(BOX(0.035, 0.026, 0.01), '#c8b070', [0, 0.05, front(0.05) - 0.008 - (belly > 1.2 ? 0.02 : 0)]); // buckle
  }
  // collar + shirt details
  const shirtShows = !!(L.open || L.tie || (!L.dress && !L.skirt && !L.sweater));
  if (!L.dress && !(L.skirt && !L.open)) { // collared shirt
    T.add(CYL(0.062, 0.07, 0.04, 14, true), L.open ? top : outer, [0, 0.585, 0]);
    for (const sx of [-1, 1]) T.add(BOX(0.06, 0.048, 0.008), L.open ? top : outer, [sx * 0.04, 0.575, -0.062], [0.35, sx * 0.55, sx * 0.62]); // spread collar points
    T.add(new THREE.TorusGeometry(0.066, 0.009, 5, 18), L.open ? top : outer, [0, 0.6, 0.004], [PI / 2 + 0.15, 0, 0], [1, 1.05, 1]); // collar band roll
  } else if (L.dress || L.skirt) T.add(CYL(0.058, 0.064, 0.02, 14, true), shade(outer, 0.9), [0, 0.6, 0]); // round neckline
  if (L.open) { // jacket / cardigan / vest: shirt panel down the front
    const pw = L.vest ? 0.1 : L.sweater ? 0.075 : 0.1;
    const ph = L.sweater ? 0.07 : 0.3, py = L.sweater ? 0.53 : 0.4;
    T.add(BOX(pw, ph, 0.016), top, [0, py, front(py) + 0.002], [-0.08, 0, 0]);
    if (!L.vest && !L.sweater) { // suit lapels + buttons
      T.add(BOX(0.048, 0.24, 0.016), shade(outer, 0.8), [-0.052, 0.43, front(0.43) - 0.003], [-0.1, 0, -0.26]).add(BOX(0.048, 0.24, 0.016), shade(outer, 0.8), [0.052, 0.43, front(0.43) - 0.003], [-0.1, 0, 0.26]);
      T.add(G.button, '#d9d4c4', [0, 0.22, front(0.22) - 0.004]).add(G.button, '#d9d4c4', [0, 0.14, front(0.14) - 0.004]);
      T.add(BOX(0.06, 0.012, 0.012), shade(outer, 0.75), [-0.095, 0.17, front(0.17) - 0.002]).add(BOX(0.06, 0.012, 0.012), shade(outer, 0.75), [0.095, 0.17, front(0.17) - 0.002]); // pockets
    } else if (L.sweater) T.add(BOX(0.012, 0.04, 0.012), shade(outer, 0.85), [-0.035, 0.53, front(0.53) - 0.004]).add(BOX(0.012, 0.04, 0.012), shade(outer, 0.85), [0.035, 0.53, front(0.53) - 0.004]);
    if (L.fem && !L.sweater) for (const y of [0.42, 0.32, 0.22]) T.add(G.button, shade(outer, 0.7), [0.055, y, front(y) - 0.004]);
    if (L.vest) for (const y of [0.4, 0.3, 0.2]) T.add(G.button, shade(outer, 0.6), [0, y, front(y) - 0.006]);
  } else if (!L.dress && !L.skirt && !L.sweater) for (const y of [0.44, 0.34, 0.24]) T.add(G.button, shade(top, 0.82), [0, y, front(y) - 0.003]); // plain shirt placket
  if (!L.open && !L.dress && !L.skirt && !L.sweater) T.add(G.shirtPocket, shade(top, 0.93), [-0.075, 0.45, front(0.45) - 0.004], [-0.1, 0, 0]); // HQ #90 breast pocket
  if (L.tie) T.add(G.knot, L.tie, [0, 0.548, front(0.545) - 0.008], [0, 0, 0], [0.85, 0.75, 0.5]).add(G.tie, L.tie, [0, 0.4, front(0.4) - 0.01], [-0.08, 0, 0]).add(G.tieTip, L.tie, [0, 0.262, front(0.27) - 0.008 - (belly > 1.2 ? 0.02 : 0)], [-0.08, 0, PI / 4]);
  if (L.skirt || L.dress) {
    const sc = L.dress ? L.top : L.skirt;
    T.add(G.skirt, sc, [0, -0.16, 0], [0, 0, 0], [xs * 0.98, 1, zs * 1.18]);
    T.add(G.dressTop, sc, [0, 0.04, 0], [0, 0, 0], [xs, 1, zs * 1.05]); // waistband blend
    if (L.dress) T.add(CYL(0.15, 0.15, 0.025, 18, true), shade(sc, 0.75), [0, 0.17, 0], [0, 0, 0], [xs * 0.9, 1, zs * 0.95]); // belt
  }
  if (L.props?.includes('pen')) T.add(G.pen, '#2b56b8', [-0.075, 0.47, front(0.47) - 0.004]).add(G.pen, '#c22', [-0.062, 0.47, front(0.47) - 0.004]);
  if (L.props?.includes('pager')) T.add(G.pager, '#1b1b1b', [0.16 * xs, 0.04, -0.03]);
  if (L.props?.includes('catPin')) T.add(G.tiny, '#c9b06b', [-0.07, 0.48, front(0.48) - 0.006]);
  if (L.props?.includes('beads')) for (let k = 0; k < 11; k++) { const a = (k / 10 - 0.5) * 2.2; T.add(G.bead, k % 2 ? '#e9e2d0' : '#c9a24a', [Math.sin(a) * 0.085, 0.555 - Math.cos(a) * 0.045, -Math.cos(a) * 0.07 - 0.02]); }
  const torso = T.mesh(true); spine.add(torso);

  // ---- head ----
  const neck = new THREE.Group(); neck.position.y = 0.74; neck.rotation.x = -(L.slump || 0); spine.add(neck);
  const headG = new THREE.Group(); neck.add(headG);
  const H = new Part(); addFace(H, L); addHair(H, L);
  headG.add(H.mesh(true));
  // HQ #90 blink: lids that drop over the eyes every few seconds (self-animating, no workers.js hook needed)
  { const B = new Part(), lc = shade(L.skin, 0.9);
    for (const sx of [-1, 1]) B.add(G.lidBlink, lc, [sx * 0.042, 0.015, -0.110], [-PI / 2 + 0.1, 0, 0], [1.08, 1, 0.62], SURF.skin);
    const blink = B.mesh(false); blink.visible = false; headG.add(blink);
    const off = (st.id || '').length * 1.37, per = 3.2 + ((st.id || 'x').charCodeAt(0) % 5) * 0.45;
    H.items.length = 0; headG.children[0].onBeforeRender = () => { const t = (performance.now() / 1000 + off) % per; blink.visible = t < 0.13 || (per > 4 && t > 0.3 && t < 0.4); }; }

  // ---- arms: shoulder group (armL/armR) -> elbow group -> hand ----
  const sx = 0.2 * xs + 0.028 + (belly > 1.2 ? 0.02 : 0);
  const sleeveCol = L.open && !L.vest ? outer : top;
  const mkArm = side => {
    const g = new THREE.Group(); g.position.set(side * sx, 0.5, 0);
    const A = new Part();
    A.add(G.deltoid, sleeveCol, [0, -0.005, 0], [0, 0, 0], [1, 1.05, 1]);
    if (L.sleeves === 'short') A.add(G.sleeveShort, sleeveCol, [0, -0.06, 0]).add(G.upper, L.skin, [0, -0.15, 0], [0, 0, 0], [0.9, 1, 0.9]);
    else A.add(G.upper, sleeveCol, [0, -0.14, 0]);
    g.add(A.mesh(true));
    const el = new THREE.Group(); el.position.y = -0.28; g.add(el);
    const F = new Part();
    if (L.sleeves === 'short') F.add(G.fore, L.skin, [0, -0.12, 0], [0, 0, 0], [0.92, 1, 0.92]);
    else F.add(G.fore, sleeveCol, [0, -0.115, 0]).add(G.cuff, L.open && !L.vest && !L.sweater ? top : shade(sleeveCol, 0.88), [0, -0.235, 0]);
    F.add(G.hand, L.skin, [0, -0.28, -0.004], [0, 0, 0], [0.8, 0.85, 0.55]).add(G.thumb, L.skin, [-side * 0.024, -0.275, -0.02], [0.4, 0, side * 0.55]);
    for (let f = 0; f < 4; f++) F.add(G.finger, L.skin, [(f - 1.5) * 0.0155 * -side, -0.33 + Math.abs(f - 1.3) * 0.004, -0.008 - f * 0.001], [0.18, 0, (f - 1.5) * 0.05 * side], [1, 0.9 + (f === 1 || f === 2 ? 0.15 : 0), 1]); // HQ #90 fingers
    if (L.props?.includes('watch') || (side < 0 && !L.fem && L.sleeves === 'short')) F.add(G.cuff, '#222', [0, -0.235, 0], [0, 0, 0], [0.95, 0.7, 0.95]); // Dwight's watch
    el.add(F.mesh(false));
    spine.add(g); return [g, el];
  };
  const [armL, elbowL] = mkArm(-1), [armR, elbowR] = mkArm(1);

  // ---- legs: hip group (legL/legR) -> knee group -> shin + shoe ----
  const skirted = !!(L.skirt || L.dress);
  const legCol = skirted ? (L.legs || L.skin) : pants;
  const shoeCol = skirted ? (L.dress ? '#1a1214' : '#2a1d18') : L.pants === '#c4ab7c' ? '#5a3a22' : '#1e1b19';
  const mkLeg = side => {
    const g = new THREE.Group(); g.position.set(side * 0.08 * xs, hip, 0);
    const Th = new Part(); Th.add(G.thigh, legCol, [0, -0.19, 0], [0, 0, 0], skirted ? [0.82, 1, 0.82] : [1, 1, 1], skirted ? SURF.skin : undefined);
    if (!skirted) Th.add(G.crease, shade(pants, 0.82), [0, -0.2, -0.064], [0, 0, 0], [1, 0.9, 1]);
    g.add(Th.mesh(true));
    const kn = new THREE.Group(); kn.position.y = -0.38; g.add(kn);
    const S = new Part();
    S.add(G.shin, legCol, [0, -0.17, 0], [0, 0, 0], skirted ? [0.78, 1, 0.78] : [1, 1, 1]);
    if (!skirted) S.add(CYL(0.058, 0.06, 0.04, 12, true), shade(pants, 0.85), [0, -0.33, 0]); // trouser hem
    S.add(G.shoe, shoeCol, [0, -0.38, -0.035], [0, 0, 0], [1.2, 0.85, 1]);
    S.add(G.sole, shade(shoeCol, 0.6), [0, -0.415, -0.035], [0, 0, 0], [0.98, 1, 0.92], SURF.plastic);
    if (!skirted) { S.add(G.lace, shade(shoeCol, 1.6), [0, -0.352, -0.085], [-0.35, 0, 0]); S.add(G.crease, shade(pants, 0.82), [0, -0.15, -0.054]); } // laces + trouser crease
    if (skirted && L.fem && L.dress) S.add(CYL(0.008, 0.008, 0.05, 6), shoeCol, [0, -0.395, 0.03]); // heel
    kn.add(S.mesh(false));
    body.add(g); return [g, kn];
  };
  const [legL, kneeL] = mkLeg(-1), [legR, kneeR] = mkLeg(1);

  // hand props (workers.js shows/hides cup + phone); they ride the forearm so they follow the elbow
  const cup = new THREE.Mesh(cupGeo || CYL(0.035, 0.03, 0.09, 8), cupMat || new THREE.MeshStandardMaterial({ color: '#f2f2f0' })); cup.position.set(0, -0.31, -0.045); cup.visible = false; elbowR.add(cup);
  const phone = new THREE.Mesh(phoneGeo || BOX(0.07, 0.13, 0.012), phoneMat || new THREE.MeshStandardMaterial({ color: '#16181c' })); phone.position.set(0, -0.31, -0.03); phone.rotation.x = PI / 2; phone.visible = false; elbowR.add(phone);
  const extras = [];
  if (L.props?.includes('bossMug')) { const m = bossMug(); m.position.set(0, -0.31, -0.05); elbowL.add(m); extras.push({ obj: m, standOnly: true, upright: true }); }

  root.scale.setScalar(L.h || 1);
  root.userData.look = L;
  return { root, body, spine, torso, headG, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, cup, phone, extras, look: L };
}
