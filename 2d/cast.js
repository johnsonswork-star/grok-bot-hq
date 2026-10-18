// Seated Office cast, drawn with smooth curves in sprite units.
// Anchor is the seat (bottom center). Front sprites face the camera from behind a desk.
// Back sprites sit with their back to the camera. The on-screen size stays the same as the chunky pass:
// a head is still about one monitor wide, just rounder, with real shading instead of big rectangles.

const INK = 'rgba(36,22,14,.88)';
const EYE = '#243044';

const sh = (h, f) => {
  const [r, g, b] = rgb(h);
  const k = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(r)},${k(g)},${k(b)})`;
};
function rgb(h) {
  if (!h) return [0, 0, 0];
  if (h.startsWith('rgb')) { const m = h.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]]; }
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

export const CAST = {
  grok:     { skin: '#f3c7a4', hair: '#3a2618', style: 'slick', shirt: '#f4f1ea', jacket: '#343c4e', tie: '#b42334', mouth: 'smile', brow: 'soft', chair: 'exec' },
  inbox:    { skin: '#f6d0b4', hair: '#c45438', style: 'pony', shirt: '#f7f1e6', cardigan: '#d9a3bf', mouth: 'smile', brow: 'soft', fem: 1, blush: 1 },
  cos:      { skin: '#f0c49c', hair: '#6a4528', style: 'messy', shirt: '#d7e4f4', tie: '#3c5278', mouth: 'smirk', brow: 'up' },
  assist:   { skin: '#f1c9a3', hair: '#6b4a1e', style: 'part', shirt: '#e0b83a', tie: '#5c3c1c', mouth: 'flat', brow: 'stern', glasses: 1 },
  icons:    { skin: '#f2c8a2', hair: '#a67a42', style: 'short', shirt: '#f4f1ea', vest: '#b23a42', tie: '#2c3f6e', mouth: 'grin', brow: 'up' },
  onpad:    { skin: '#f3cdb0', hair: '#c47848', style: 'curly', shirt: '#8d62b0', mouth: 'smile', brow: 'soft', fem: 1, blush: 1, wide: 1 },
  builder:  { skin: '#6e4a34', hair: '#c8c4bc', style: 'bald', shirt: '#f3f0e8', vest: '#5a4838', tie: '#8a1e30', mouth: 'flat', brow: 'stern', stache: '#d4d0c8' },
  faith:    { skin: '#f7d7c0', hair: '#f0d48a', style: 'bun', shirt: '#f7f1ea', cardigan: '#e7b4c6', mouth: 'frown', brow: 'stern', fem: 1 },
  broker:   { skin: '#c4926c', hair: '#1c1614', style: 'short', shirt: '#8fafc4', mouth: 'smile', brow: 'soft' },
  conn:     { skin: '#f0c4a0', hair: '#d8b898', style: 'bald', shirt: '#4b6a8a', mouth: 'grin', brow: 'soft', wide: 1, round: 1 },
  review:   { skin: '#e6c4aa', hair: '#d9d6cf', style: 'stringy', shirt: '#d9d4c8', jacket: '#6d6a58', mouth: 'creep', brow: 'soft', sleepy: 1 },
  kids:     { skin: '#f2c7a8', hair: '#c4462a', style: 'chop', shirt: '#4e8a45', mouth: 'smirk', brow: 'soft', sleepy: 1, fem: 1 },
  designer: { skin: '#c99272', hair: '#140e0c', style: 'long', shirt: '#e4548c', mouth: 'grin', brow: 'up', fem: 1, blush: 1, hoops: 1 },
  profile:  { skin: '#efc7a5', hair: '#8a7560', style: 'balding', shirt: '#c5ced6', tie: '#5a6a7a', mouth: 'frown', brow: 'sad' },
};

export function crewLook(id) { return CAST[id] || CAST.cos; }

// Sprite bounds relative to the seat anchor, for tap targets.
export const CREW_HIT = { x: -16, y: -46, w: 32, h: 48 };

export function paintCrew(c, id, sx, sy, opt = {}) {
  const L = crewLook(id);
  c.save();
  c.translate(sx, sy - (opt.bob || 0));
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (opt.back) paintBack(c, L);
  else paintFront(c, L, opt);
  c.restore();
}

function stroke(c, col = INK, w = 0.85) {
  c.strokeStyle = col;
  c.lineWidth = w;
  c.stroke();
}

function chair(c, L, y, h, front) {
  const exec = L.chair === 'exec';
  const wide = L.wide ? 2 : 0;
  const w = 24 + wide, x = -w / 2;
  const cloth = exec ? '#5a4030' : '#3d4a62';
  const hi = exec ? '#7a5a40' : '#6a7c9a';
  const dk = exec ? '#2c2016' : '#2a3344';
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, hi);
  g.addColorStop(0.45, cloth);
  g.addColorStop(1, dk);
  c.beginPath();
  c.roundRect(x, y, w, h, front ? 4 : 5);
  c.fillStyle = g;
  c.fill();
  stroke(c, 'rgba(28,18,10,.75)', 0.9);
  // top rail highlight
  c.beginPath();
  c.moveTo(x + 3, y + 2.2);
  c.quadraticCurveTo(0, y + 1.2, x + w - 3, y + 2.4);
  c.strokeStyle = 'rgba(255,236,210,.35)';
  c.lineWidth = 0.7;
  c.stroke();
}

function arm(c, x, y, col, skin) {
  const g = c.createLinearGradient(x, y, x + 5, y + 12);
  g.addColorStop(0, sh(col, 1.12));
  g.addColorStop(1, sh(col, 0.78));
  c.beginPath();
  c.roundRect(x, y, 4.4, 11, 2);
  c.fillStyle = g;
  c.fill();
  stroke(c, 'rgba(36,22,14,.55)', 0.6);
  // hand
  c.beginPath();
  c.ellipse(x + 2.2, y + 11.2, 2.3, 1.7, 0, 0, Math.PI * 2);
  c.fillStyle = skin;
  c.fill();
  stroke(c, 'rgba(36,22,14,.45)', 0.5);
}

function torso(c, L) {
  const wide = L.wide ? 2 : 0;
  const bw = 15 + wide, bx = -bw / 2;
  const sleeve = L.vest ? L.shirt : (L.jacket || L.cardigan || L.shirt);
  arm(c, bx - 4.6, -20, sleeve, L.skin);
  arm(c, bx + bw + 0.2, -20, sh(sleeve, 0.86), sh(L.skin, 0.9));
  const g = c.createLinearGradient(bx, -22, bx + bw, -8);
  g.addColorStop(0, sh(L.shirt, 1.08));
  g.addColorStop(0.55, L.shirt);
  g.addColorStop(1, sh(L.shirt, 0.82));
  c.beginPath();
  c.roundRect(bx, -22, bw, 14, [5, 5, 3, 3]);
  c.fillStyle = g;
  c.fill();
  stroke(c, 'rgba(36,22,14,.7)', 0.8);
  if (L.jacket) {
    const j = L.jacket;
    c.fillStyle = j;
    c.beginPath();
    c.moveTo(bx + 0.4, -21.4);
    c.lineTo(bx + 4.6, -21.4);
    c.lineTo(bx + 3.2, -9.2);
    c.lineTo(bx + 0.4, -9.2);
    c.closePath();
    c.fill();
    c.fillStyle = sh(j, 0.78);
    c.beginPath();
    c.moveTo(bx + bw - 0.4, -21.4);
    c.lineTo(bx + bw - 4.6, -21.4);
    c.lineTo(bx + bw - 3.2, -9.2);
    c.lineTo(bx + bw - 0.4, -9.2);
    c.closePath();
    c.fill();
    c.fillStyle = '#f7f4ee';
    c.fillRect(bx + bw - 4.2, -16.5, 1.6, 1.6);
  } else if (L.cardigan) {
    const j = L.cardigan;
    c.fillStyle = j;
    c.beginPath(); c.roundRect(bx - 0.2, -21.6, 3.4, 13.2, 1.5); c.fill();
    c.fillStyle = sh(j, 0.82);
    c.beginPath(); c.roundRect(bx + bw - 3.2, -21.6, 3.4, 13.2, 1.5); c.fill();
    c.fillStyle = '#f4efe4';
    c.beginPath(); c.arc(bx + 1.5, -16.2, 0.45, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bx + 1.5, -13.4, 0.45, 0, Math.PI * 2); c.fill();
    if (L.style === 'bun') {
      c.fillStyle = '#e8a04a';
      c.beginPath(); c.ellipse(bx + bw - 4.2, -15.2, 1.5, 1.3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2a1c10';
      c.fillRect(bx + bw - 4.8, -15.6, 0.7, 0.7);
      c.fillRect(bx + bw - 3.6, -15.6, 0.7, 0.7);
    }
  } else if (L.vest) {
    c.fillStyle = L.vest;
    c.beginPath(); c.roundRect(bx + 0.6, -20.6, 3.2, 11.6, 1); c.fill();
    c.fillStyle = sh(L.vest, 0.8);
    c.beginPath(); c.roundRect(bx + bw - 3.8, -20.6, 3.2, 11.6, 1); c.fill();
    c.fillStyle = '#e6d7a4';
    c.beginPath(); c.arc(bx + 2.1, -16.4, 0.45, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(bx + bw - 2.2, -16.4, 0.45, 0, Math.PI * 2); c.fill();
  }
  if (L.tie) {
    const mx = 0.2;
    c.fillStyle = '#f7f7f4';
    c.beginPath();
    c.moveTo(mx - 2.4, -21.2); c.lineTo(mx - 0.3, -21.2); c.lineTo(mx - 0.6, -18.6); c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(mx + 2.2, -21.2); c.lineTo(mx + 0.2, -21.2); c.lineTo(mx + 0.5, -18.6); c.closePath(); c.fill();
    const g = c.createLinearGradient(mx - 1, -19, mx + 2, -9);
    g.addColorStop(0, sh(L.tie, 1.15));
    g.addColorStop(1, sh(L.tie, 0.75));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(mx - 1.15, -18.8);
    c.lineTo(mx + 1.15, -18.8);
    c.lineTo(mx + 1.7, -10.4);
    c.lineTo(mx, -8.8);
    c.lineTo(mx - 1.7, -10.4);
    c.closePath();
    c.fill();
  }
}

function neck(c, skin) {
  c.fillStyle = sh(skin, 0.86);
  c.beginPath();
  c.roundRect(-2.1, -24.2, 4.2, 4.2, 1.2);
  c.fill();
}

function head(c, L, opt) {
  const rx = (L.round ? 9.4 : 8.6) + (L.wide ? 0.6 : 0);
  const ry = L.round ? 9.6 : 9.1;
  const cy = -33.2;
  // ears
  ear(c, -rx + 0.2, cy + 1.5, L, -1);
  ear(c, rx - 0.2, cy + 1.5, L, 1);
  // skull
  c.beginPath();
  c.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2);
  const g = c.createRadialGradient(-rx * 0.35, cy - ry * 0.45, rx * 0.15, 0.4, cy + 1, rx * 1.35);
  g.addColorStop(0, sh(L.skin, 1.16));
  g.addColorStop(0.5, L.skin);
  g.addColorStop(1, sh(L.skin, 0.8));
  c.fillStyle = g;
  c.fill();
  stroke(c, 'rgba(42,26,16,.72)', 0.85);
  hairFront(c, L, cy, rx, ry);
  face(c, L, cy, opt);
}

function ear(c, x, y, L, dir) {
  c.beginPath();
  c.ellipse(x, y, 1.7, 2.3, 0, 0, Math.PI * 2);
  c.fillStyle = sh(L.skin, dir < 0 ? 0.86 : 0.96);
  c.fill();
  stroke(c, 'rgba(42,26,16,.45)', 0.45);
  if (L.hoops) {
    c.beginPath();
    c.arc(x + dir * 0.2, y + 1.6, 1.15, 0.2, Math.PI - 0.2);
    c.strokeStyle = '#e6c15a';
    c.lineWidth = 0.7;
    c.stroke();
  }
}

function hairFront(c, L, cy, rx, ry) {
  const hair = L.hair, hi = sh(hair, 1.45), lo = sh(hair, 0.62);
  if (L.style === 'bald') {
    c.fillStyle = lo;
    c.beginPath(); c.ellipse(-rx + 1.2, cy + 2, 1.5, 3.2, 0.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(rx - 1.2, cy + 2, 1.5, 3.2, -0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.45)';
    c.beginPath(); c.ellipse(-1.2, cy - 3, 1.4, 0.7, -0.4, 0, Math.PI * 2); c.fill();
    return;
  }
  const cap = (extra) => {
    c.beginPath();
    c.ellipse(0, cy - 1.1, rx + 0.55, ry * 0.72, 0, Math.PI * 0.98, Math.PI * 2.02, false);
    if (extra) extra();
    else {
      c.quadraticCurveTo(rx * 0.4, cy - 0.5, 0, cy + 0.2);
      c.quadraticCurveTo(-rx * 0.45, cy - 0.4, -rx - 0.4, cy - 1);
    }
    c.closePath();
  };
  c.fillStyle = hair;
  if (L.style === 'balding') {
    c.beginPath();
    c.ellipse(-rx + 0.4, cy + 0.5, 3.1, 5.2, 0.3, 0, Math.PI * 2); c.fill();
    c.beginPath();
    c.ellipse(rx - 0.6, cy + 0.6, 3.1, 5.2, -0.3, 0, Math.PI * 2); c.fill();
    c.beginPath();
    c.ellipse(0, cy - ry + 2.2, 4.2, 2.2, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = hi;
    c.beginPath(); c.ellipse(-1, cy - ry + 2.4, 1.6, 0.7, -0.3, 0, Math.PI * 2); c.fill();
    return;
  }
  if (L.style === 'stringy') {
    c.beginPath();
    c.ellipse(0, cy - ry + 3.4, 5.2, 2.4, 0, Math.PI, 0);
    c.fill();
    strand(c, -rx + 0.5, cy + 1, 2.2, 8, hair, lo);
    strand(c, rx - 2.4, cy + 1.5, 2, 7, lo, hair);
    return;
  }
  cap(L.style === 'long' ? () => {
    c.quadraticCurveTo(rx, cy + 1, rx * 0.2, cy + 1.4);
    c.quadraticCurveTo(-rx * 0.1, cy - 1, -rx - 0.3, cy - 1);
  } : L.style === 'pony' ? () => {
    c.quadraticCurveTo(rx * 0.85, cy + 0.4, 1, cy + 0.6);
    c.quadraticCurveTo(-2, cy - 1.5, -rx - 0.3, cy - 2);
  } : null);
  c.fill();
  // shine
  c.fillStyle = hi;
  c.beginPath();
  c.ellipse(-3.1, cy - ry * 0.55, 3.2, 1.5, -0.5, 0, Math.PI * 2);
  c.fill();
  if (L.style === 'slick') {
    c.fillStyle = sh(L.skin, 1.05);
    c.beginPath();
    c.moveTo(-0.4, cy - ry + 1.6);
    c.quadraticCurveTo(0.8, cy - 2, 0.3, cy - 0.2);
    c.quadraticCurveTo(-0.6, cy - 2.2, -0.4, cy - ry + 1.6);
    c.fill();
    sideburn(c, -rx + 0.2, cy + 1.2, hair);
    sideburn(c, rx - 1.8, cy + 1.4, lo);
  } else if (L.style === 'messy' || L.style === 'chop') {
    tuft(c, -6.5, cy - ry + 0.4, hair, -0.5);
    tuft(c, -1.5, cy - ry - 1.2, hi, 0.2);
    tuft(c, 3.5, cy - ry + 0.2, lo, 0.6);
    sideburn(c, -rx + 0.1, cy + 1, hair);
    sideburn(c, rx - 1.7, cy + 1.5, lo);
  } else if (L.style === 'part') {
    c.fillStyle = sh(L.skin, 1.08);
    c.beginPath();
    c.ellipse(1.1, cy - 3.5, 0.7, 3.2, 0.15, 0, Math.PI * 2);
    c.fill();
    sideburn(c, -rx + 0.2, cy + 1, hair);
    sideburn(c, rx - 1.6, cy + 1.3, lo);
  } else if (L.style === 'short') {
    sideburn(c, -rx + 0.3, cy + 1.4, hair);
    sideburn(c, rx - 1.5, cy + 1.6, lo);
  } else if (L.style === 'curly') {
    curls(c, cy, hair, hi, lo, rx);
  } else if (L.style === 'bun') {
    c.fillStyle = hair;
    c.beginPath(); c.ellipse(0, cy - ry - 1.5, 3.6, 3.3, 0, 0, Math.PI * 2); c.fill();
    stroke(c, 'rgba(36,22,14,.55)', 0.6);
    c.fillStyle = hi;
    c.beginPath(); c.ellipse(-1.1, cy - ry - 2.2, 1.3, 1, -0.4, 0, Math.PI * 2); c.fill();
    // bangs
    c.fillStyle = hair;
    c.beginPath();
    c.ellipse(0, cy - 1.2, rx * 0.72, 2.2, 0, 0, Math.PI * 2);
    c.fill();
  } else if (L.style === 'long') {
    c.fillStyle = hair;
    lock(c, -rx - 0.2, cy + 1, 4.2, 16, hair, hi);
    lock(c, rx - 3.6, cy + 1, 4.2, 16, lo, hair);
    // thick bangs
    c.fillStyle = hair;
    c.beginPath();
    c.ellipse(0, cy - 0.4, rx * 0.78, 2.8, 0, 0, Math.PI);
    c.fill();
  } else if (L.style === 'pony') {
    c.fillStyle = hair;
    c.beginPath();
    c.ellipse(-1.5, cy - 0.6, 6, 2.1, -0.2, 0, Math.PI * 2);
    c.fill();
    sideburn(c, -rx + 0.2, cy + 1.2, hair);
  }
}

function tuft(c, x, y, col, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(0, 0, 2.4, 1.5, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function sideburn(c, x, y, col) {
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(x + 0.8, y, 1.3, 2.4, 0, 0, Math.PI * 2);
  c.fill();
}
function strand(c, x, y, w, h, col, edge) {
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(x + w, y + h * 0.4, x + w * 0.4, y + h);
  c.quadraticCurveTo(x + w * 0.2, y + h * 0.5, x, y);
  c.fill();
  c.fillStyle = edge;
  c.beginPath();
  c.ellipse(x + w * 0.65, y + 2, 0.7, 1.6, 0.4, 0, Math.PI * 2);
  c.fill();
}
function lock(c, x, y, w, h, col, hi) {
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, hi);
  g.addColorStop(0.35, col);
  g.addColorStop(1, sh(col, 0.75));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x + 0.4, y);
  c.quadraticCurveTo(x - 0.6, y + h * 0.55, x + 1.2, y + h);
  c.quadraticCurveTo(x + w * 0.7, y + h + 1, x + w, y + h * 0.7);
  c.quadraticCurveTo(x + w + 0.4, y + h * 0.2, x + w * 0.7, y);
  c.closePath();
  c.fill();
  stroke(c, 'rgba(20,12,8,.45)', 0.55);
}
function curls(c, cy, hair, hi, lo, rx) {
  const spots = [[-rx - 1, cy - 2, 3.1], [-rx + 1, cy + 2, 2.8], [-rx - 0.4, cy + 5, 2.6],
    [rx + 1, cy - 1, 3.1], [rx - 1, cy + 3, 2.8], [rx + 0.2, cy + 6, 2.5],
    [-4, cy - 8.2, 2.4], [2, cy - 8.6, 2.2], [-1, cy - 6.4, 2]];
  for (const [x, y, r] of spots) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = hair;
    c.fill();
    stroke(c, 'rgba(36,22,14,.4)', 0.45);
  }
  c.fillStyle = hi;
  c.beginPath(); c.arc(-rx + 0.5, cy - 1, 1.1, 0, Math.PI * 2); c.fill();
  c.fillStyle = lo;
  c.beginPath(); c.arc(rx - 0.2, cy + 2, 1, 0, Math.PI * 2); c.fill();
  // fringe
  c.fillStyle = hair;
  c.beginPath();
  c.ellipse(0, cy - 1.5, rx * 0.7, 2.4, 0, 0, Math.PI);
  c.fill();
}

function face(c, L, cy, opt) {
  const b = sh(L.hair === '#f0d48a' || L.hair === '#d9d6cf' || L.hair === '#c8c4bc' || L.hair === '#d8b898' ? '#6a5038' : L.hair, 0.55);
  const brow = (x, y, tilt) => {
    c.strokeStyle = b;
    c.lineWidth = 0.7;
    c.beginPath();
    c.moveTo(x - 2.3, y + tilt);
    c.quadraticCurveTo(x, y - 0.4, x + 2.3, y);
    c.stroke();
  };
  const yb = cy - 1.6;
  if (L.brow === 'stern') { brow(-3.6, yb + 0.4, -0.7); brow(3.6, yb + 0.4, 0.7); }
  else if (L.brow === 'sad') { brow(-3.6, yb, 0.7); brow(3.6, yb, -0.7); }
  else if (L.brow === 'up') { brow(-3.6, yb - 0.6, 0.2); brow(3.6, yb - 0.6, -0.2); }
  else { brow(-3.6, yb, 0); brow(3.6, yb, 0); }
  eye(c, -3.5, cy + 1.15, L, opt);
  eye(c, 3.5, cy + 1.15, L, opt);
  if (L.glasses) {
    c.strokeStyle = '#1c1c1c';
    c.lineWidth = 0.7;
    c.beginPath(); c.roundRect(-6.3, cy - 0.2, 5.4, 3.6, 1); c.stroke();
    c.beginPath(); c.roundRect(0.9, cy - 0.2, 5.4, 3.6, 1); c.stroke();
    c.beginPath(); c.moveTo(-0.9, cy + 1.4); c.lineTo(0.9, cy + 1.4); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 0.45;
    c.beginPath(); c.moveTo(-5.6, cy + 0.4); c.lineTo(-4.4, cy + 1.3); c.stroke();
  }
  // nose
  c.strokeStyle = sh(L.skin, 0.72);
  c.lineWidth = 0.6;
  c.beginPath();
  c.moveTo(0.1, cy + 2.2);
  c.quadraticCurveTo(0.7, cy + 3.6, 0.15, cy + 4);
  c.stroke();
  if (L.blush) {
    c.fillStyle = 'rgba(214,96,110,.35)';
    c.beginPath(); c.ellipse(-5.4, cy + 3.6, 1.7, 0.9, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(5.4, cy + 3.6, 1.7, 0.9, 0, 0, Math.PI * 2); c.fill();
  }
  mouth(c, L, cy + 5.6);
  if (L.stache) {
    c.fillStyle = L.stache;
    c.beginPath();
    c.ellipse(0, cy + 5.1, 4.6, 1.35, 0, 0, Math.PI);
    c.fill();
    c.beginPath();
    c.ellipse(-3.6, cy + 5.6, 1.3, 1.1, 0.4, 0, Math.PI * 2); c.fill();
    c.beginPath();
    c.ellipse(3.6, cy + 5.6, 1.3, 1.1, -0.4, 0, Math.PI * 2); c.fill();
  }
}

function eye(c, x, y, L, opt) {
  if (opt.blink) {
    c.strokeStyle = '#3a2a22';
    c.lineWidth = 0.75;
    c.beginPath();
    c.moveTo(x - 2.2, y);
    c.quadraticCurveTo(x, y + 0.85, x + 2.2, y);
    c.stroke();
    return;
  }
  if (L.fem && !L.sleepy) {
    c.strokeStyle = '#2a211c';
    c.lineWidth = 0.7;
    c.beginPath();
    c.moveTo(x - 2.4, y - 1.5);
    c.quadraticCurveTo(x, y - 2.3, x + 2.5, y - 1.35);
    c.stroke();
  }
  const h = L.sleepy ? 1.55 : 2.35;
  c.fillStyle = '#f8f7f3';
  c.beginPath();
  c.ellipse(x, y, 2.25, h, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = EYE;
  c.beginPath();
  c.ellipse(x + 0.25, y + 0.25, L.sleepy ? 0.85 : 1.15, L.sleepy ? 0.95 : 1.3, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(x - 0.45, y - 0.45, 0.5, 0, Math.PI * 2);
  c.fill();
  // lower lid shade
  c.strokeStyle = sh(L.skin, 0.75);
  c.lineWidth = 0.45;
  c.beginPath();
  c.moveTo(x - 1.8, y + h * 0.55);
  c.quadraticCurveTo(x, y + h * 0.95, x + 1.8, y + h * 0.5);
  c.stroke();
}

function mouth(c, L, y) {
  const lip = '#8e3d3a', hi = '#e09a92';
  c.lineCap = 'round';
  c.strokeStyle = lip;
  c.lineWidth = 0.8;
  if (L.mouth === 'grin') {
    c.beginPath();
    c.moveTo(-3.4, y - 0.2);
    c.quadraticCurveTo(0, y + 2.6, 3.4, y - 0.2);
    c.stroke();
    c.fillStyle = '#f4f1ea';
    c.beginPath();
    c.moveTo(-2.4, y + 0.2);
    c.quadraticCurveTo(0, y + 2.1, 2.4, y + 0.2);
    c.quadraticCurveTo(0, y + 0.7, -2.4, y + 0.2);
    c.fill();
    c.strokeStyle = hi;
    c.lineWidth = 0.5;
    c.beginPath();
    c.moveTo(-2.2, y + 0.15);
    c.quadraticCurveTo(0, y + 1.1, 2.2, y + 0.15);
    c.stroke();
  } else if (L.mouth === 'smile') {
    c.beginPath();
    c.moveTo(-2.6, y);
    c.quadraticCurveTo(0, y + 1.8, 2.6, y);
    c.stroke();
  } else if (L.mouth === 'smirk') {
    c.beginPath();
    c.moveTo(-2.4, y + 0.3);
    c.quadraticCurveTo(0.2, y + 0.1, 2.8, y - 0.8);
    c.stroke();
  } else if (L.mouth === 'frown') {
    c.beginPath();
    c.moveTo(-2.5, y + 0.7);
    c.quadraticCurveTo(0, y - 0.5, 2.5, y + 0.7);
    c.stroke();
  } else if (L.mouth === 'creep') {
    c.beginPath();
    c.moveTo(-3, y);
    c.quadraticCurveTo(-1, y + 1.1, 0.2, y + 0.2);
    c.quadraticCurveTo(1.6, y + 1.3, 3, y - 0.2);
    c.stroke();
  } else {
    c.beginPath();
    c.moveTo(-2.2, y + 0.3);
    c.lineTo(2.2, y + 0.3);
    c.stroke();
  }
}

function paintFront(c, L, opt) {
  chair(c, L, -30, 18, false);
  torso(c, L);
  neck(c, L.skin);
  head(c, L, opt);
  if (L.style === 'pony') {
    const hair = L.hair;
    c.fillStyle = hair;
    c.beginPath(); c.ellipse(8.2, -28, 2.4, 2.2, 0.4, 0, Math.PI * 2); c.fill();
    lock(c, 6.4, -27, 3.6, 12, sh(hair, 0.85), sh(hair, 1.3));
  }
}

function paintBack(c, L) {
  const wide = L.wide ? 2 : 0;
  const top = L.jacket || L.cardigan || L.vest || L.shirt;
  const bw = 15 + wide, bx = -bw / 2;
  // arms and back of the shirt, seen from behind
  arm(c, bx - 4.6, -22, sh(L.shirt, 0.9), sh(L.skin, 0.85));
  arm(c, bx + bw + 0.2, -22, sh(top, 0.75), sh(L.skin, 0.8));
  const g = c.createLinearGradient(bx, -24, bx + bw, -8);
  g.addColorStop(0, sh(top, 1.08));
  g.addColorStop(0.7, top);
  g.addColorStop(1, sh(top, 0.78));
  c.beginPath();
  c.roundRect(bx, -24, bw, 15, 4);
  c.fillStyle = g;
  c.fill();
  stroke(c, 'rgba(36,22,14,.7)', 0.8);
  // spine shade
  c.strokeStyle = 'rgba(0,0,0,.12)';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(0, -22);
  c.lineTo(0.4, -10);
  c.stroke();
  neck(c, L.skin);
  // head from behind
  const cy = -33;
  const rx = 8.4 + (L.wide ? 0.5 : 0);
  const hr = (L.style === 'bald' || L.style === 'balding') ? L.skin : L.hair;
  c.beginPath();
  c.ellipse(0, cy, rx, 8.8, 0, 0, Math.PI * 2);
  const hg = c.createRadialGradient(-3, cy - 4, 1, 1, cy, rx * 1.3);
  hg.addColorStop(0, sh(hr, 1.2));
  hg.addColorStop(1, sh(hr, 0.78));
  c.fillStyle = hg;
  c.fill();
  stroke(c, 'rgba(36,22,14,.65)', 0.8);
  if (L.style === 'bald' || L.style === 'balding') {
    c.fillStyle = sh(L.hair, 0.7);
    c.beginPath();
    c.ellipse(0, cy + 4.2, rx * 0.85, 2.4, 0, 0, Math.PI);
    c.fill();
    if (L.style === 'balding') {
      c.fillStyle = L.hair;
      c.beginPath(); c.ellipse(-6, cy - 1, 2.4, 4, 0.4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(6, cy - 1, 2.4, 4, -0.4, 0, Math.PI * 2); c.fill();
    }
  } else if (L.style === 'bun') {
    c.fillStyle = L.hair;
    c.beginPath(); c.ellipse(0, cy - 10, 3.4, 3.1, 0, 0, Math.PI * 2); c.fill();
  } else if (L.style === 'long' || L.style === 'stringy' || L.style === 'pony') {
    lock(c, -rx - 1, cy + 2, 4, L.style === 'stringy' ? 12 : 16, L.hair, sh(L.hair, 1.25));
    lock(c, rx - 3, cy + 2, 4, L.style === 'stringy' ? 11 : 16, sh(L.hair, 0.8), L.hair);
    if (L.style === 'pony') {
      c.fillStyle = L.hair;
      c.beginPath(); c.ellipse(0, cy - 6, 2.2, 2, 0, 0, Math.PI * 2); c.fill();
      lock(c, -1.2, cy - 5, 3.4, 14, sh(L.hair, 0.85), sh(L.hair, 1.3));
    }
  } else if (L.style === 'curly') {
    curls(c, cy, L.hair, sh(L.hair, 1.35), sh(L.hair, 0.7), rx);
  } else if (L.style === 'messy' || L.style === 'chop') {
    tuft(c, -5, cy - 8, L.hair, -0.4);
    tuft(c, 2, cy - 9, sh(L.hair, 1.3), 0.3);
    tuft(c, 6, cy - 7, sh(L.hair, 0.75), 0.5);
  }
  // chair back sits in front of the lap
  chair(c, L, -16, 14, true);
}
