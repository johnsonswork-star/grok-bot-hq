// 16-bit seated Office cast. Buffer pixels, anchor at the seat (bottom center).
// Front sprites face the camera from behind a desk. Back sprites sit with their back to the camera.

const INK = '#24160e';
const EYE = '#1c2430';

const sh = (h, f) => {
  const n = parseInt(h.slice(1), 16);
  const k = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(n >> 16 & 255)},${k(n >> 8 & 255)},${k(n & 255)})`;
};

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
  const ay = sy - 46 - (opt.bob || 0);
  const p = (x, y, w, h, col) => { if (col && w > 0 && h > 0) { c.fillStyle = col; c.fillRect(sx + x, ay + y, w, h); } };
  if (opt.back) paintBack(p, L);
  else paintFront(p, L, opt);
}

function paintFront(p, L, opt) {
  const skin = L.skin, skinD = sh(skin, 0.78), skinH = sh(skin, 1.1);
  const hair = L.hair, hairH = sh(hair, 1.45), hairD = sh(hair, 0.62);
  const wide = L.wide ? 2 : 0;
  chairBack(p, L, 14, wide);
  torso(p, L, wide);
  neck(p, skinD);
  head(p, L, skin, skinD, skinH, hair, hairH, hairD, opt);
  if (L.style === 'pony') ponyTail(p, hair, hairH, hairD);
  if (L.style === 'long') longHair(p, hair, hairH, hairD);
  if (L.style === 'stringy') stringy(p, hair, hairH, hairD);
  if (L.style === 'curly') curlySides(p, hair, hairH, hairD);
}

function paintBack(p, L) {
  const skin = L.skin, skinD = sh(skin, 0.78);
  const hair = L.hair, hairH = sh(hair, 1.4), hairD = sh(hair, 0.62);
  const wide = L.wide ? 2 : 0;
  const top = L.jacket || L.cardigan || L.vest || L.shirt;
  const bw = 14 + wide, bx = -Math.floor(bw / 2);
  // arms + back of the shirt
  p(bx - 5, 20, 4, 12, INK);
  p(bx + bw + 1, 20, 4, 12, INK);
  p(bx - 4, 21, 3, 10, sh(L.shirt, 0.85));
  p(bx + bw + 1, 21, 3, 10, sh(top, 0.7));
  p(bx - 1, 18, bw + 2, 16, INK);
  p(bx, 19, bw, 14, top);
  p(bx + bw - 3, 20, 3, 12, sh(top, 0.8));
  p(Math.floor(bw / 2) + bx - 1, 20, 1, 12, sh(top, 0.86));
  p(bx, 19, bw, 2, sh(top, 1.12));
  p(-2, 16, 4, 4, skinD);
  // head from behind
  const hr = (L.style === 'bald' || L.style === 'balding') ? skin : hair;
  p(-9, 3, 18, 2, INK);
  p(-10, 5, 20, 12, INK);
  p(-8, 4, 16, 12, hr);
  p(-9, 6, 18, 9, hr);
  p(5, 7, 3, 8, L.style === 'bald' || L.style === 'balding' ? skinD : hairD);
  p(-8, 5, 4, 2, L.style === 'bald' || L.style === 'balding' ? sh(skin, 1.15) : hairH);
  // ears
  p(-11, 10, 2, 3, skinD);
  p(9, 10, 2, 3, skin);
  if (L.style === 'bald' || L.style === 'balding') {
    p(-8, 12, 16, 4, hairD);
    p(-2, 5, 3, 2, sh(skin, 1.2));
    if (L.style === 'balding') { p(-9, 4, 4, 8, hair); p(5, 4, 4, 8, hairD); p(-3, 3, 6, 2, hair); }
  }
  if (L.style === 'bun') { p(-4, -2, 8, 7, INK); p(-3, -1, 6, 5, hair); p(-2, -1, 2, 2, hairH); }
  if (L.style === 'pony') ponyTail(p, hair, hairH, hairD);
  if (L.style === 'long' || L.style === 'stringy') {
    p(-12, 8, 5, 22, INK); p(7, 8, 5, 22, INK);
    p(-11, 9, 4, 20, hair); p(7, 9, 4, 20, hairD);
  }
  if (L.style === 'curly') curlySides(p, hair, hairH, hairD);
  if (L.style === 'messy' || L.style === 'chop') {
    p(-10, 2, 3, 4, hair); p(7, 1, 4, 4, hair); p(-4, 2, 3, 3, hairH);
  }
  // chair back in front of the lap
  const cw = 26 + wide;
  p(-cw / 2, 24, cw, 16, INK);
  p(-cw / 2 + 1, 25, cw - 2, 14, L.chair === 'exec' ? '#4a3424' : '#3a4558');
  p(-cw / 2 + 2, 25, cw - 4, 3, L.chair === 'exec' ? '#6a4c34' : '#5c6b84');
  p(cw / 2 - 4, 25, 3, 14, L.chair === 'exec' ? '#3a2818' : '#2e3848');
  p(-cw / 2 + 1, 36, cw - 2, 3, L.chair === 'exec' ? '#2e2016' : '#2a3140');
}

function chairBack(p, L, y, wide) {
  const exec = L.chair === 'exec';
  const w = 26 + wide, x = -w / 2;
  const cloth = exec ? '#4a3424' : '#3a4558';
  const hi = exec ? '#6a4c34' : '#5c6b84';
  const dk = exec ? '#2e2016' : '#2a3140';
  p(x, y, w, 20, INK);
  p(x + 1, y + 1, w - 2, 18, cloth);
  p(x + 2, y + 2, w - 4, 3, hi);
  p(x + w - 4, y + 1, 3, 17, exec ? '#3a2818' : '#2e3848');
  p(x + 1, y + 16, w - 2, 3, dk);
  // wood posts
  p(x + 2, y + 4, 2, 12, exec ? '#6e5238' : '#2c3544');
  p(x + w - 4, y + 4, 2, 12, exec ? '#5a4030' : '#26303e');
}

function torso(p, L, wide) {
  const bw = 14 + wide, bx = -Math.floor(bw / 2);
  const sleeve = L.vest ? L.shirt : (L.jacket || L.cardigan || L.shirt);
  // arms
  p(bx - 5, 22, 5, 13, INK);
  p(bx + bw, 22, 5, 13, INK);
  p(bx - 4, 23, 4, 11, sh(sleeve, 0.92));
  p(bx + bw, 23, 4, 11, sh(sleeve, 0.72));
  p(bx - 4, 23, 1, 4, sh(sleeve, 1.15));
  // hands resting forward (just below the sleeve, on the desk line)
  p(bx - 4, 33, 4, 3, INK);
  p(bx + bw, 33, 4, 3, INK);
  p(bx - 3, 33, 3, 2, L.skin);
  p(bx + bw, 33, 3, 2, sh(L.skin, 0.88));
  // shirt
  p(bx - 1, 20, bw + 2, 16, INK);
  p(bx, 21, bw, 14, L.shirt);
  p(bx + bw - 3, 22, 3, 12, sh(L.shirt, 0.84));
  p(bx, 21, bw, 2, sh(L.shirt, 1.1));
  // collar V when no tie/jacket covers it
  if (L.jacket) {
    const j = L.jacket, jD = sh(j, 0.75), jH = sh(j, 1.18);
    p(bx, 21, 4, 14, j);
    p(bx + bw - 4, 21, 4, 14, jD);
    p(bx, 21, 4, 2, jH);
    p(bx + 3, 22, 2, 5, L.shirt);
    p(bx + bw - 5, 22, 2, 5, sh(L.shirt, 0.9));
    // pocket square
    p(bx + bw - 4, 26, 2, 2, '#f7f4ee');
  } else if (L.cardigan) {
    const j = L.cardigan, jD = sh(j, 0.8);
    p(bx, 21, 3, 14, j);
    p(bx + bw - 3, 21, 3, 14, jD);
    p(bx, 21, 3, 2, sh(j, 1.12));
    p(bx + 2, 24, 1, 1, '#f4efe4');
    p(bx + 2, 28, 1, 1, '#f4efe4');
    if (L.style === 'bun') { // Angela's cat pin
      p(bx + bw - 5, 25, 3, 3, '#e8a04a');
      p(bx + bw - 5, 25, 1, 1, '#2a1c10');
      p(bx + bw - 3, 25, 1, 1, '#2a1c10');
    }
  } else if (L.vest) {
    const v = L.vest, vD = sh(v, 0.78);
    p(bx + 1, 22, 3, 13, v);
    p(bx + bw - 4, 22, 3, 13, vD);
    p(bx + 1, 22, 3, 1, sh(v, 1.15));
    p(bx + 2, 26, 1, 1, '#e6d7a4');
    p(bx + bw - 3, 26, 1, 1, '#e6d7a4');
  }
  if (L.tie) {
    const t = L.tie, tD = sh(t, 0.72), tH = sh(t, 1.22);
    const mx = bx + Math.floor(bw / 2);
    p(mx - 3, 21, 2, 3, '#f7f7f4');
    p(mx + 1, 21, 2, 3, '#f7f7f4');
    p(mx - 1, 22, 2, 2, tH);
    p(mx - 1, 24, 2, 8, t);
    p(mx, 24, 1, 8, tD);
    p(mx - 2, 31, 4, 2, t);
  }
}

function neck(p, skinD) { p(-2, 18, 4, 4, skinD); p(-1, 18, 2, 1, sh(skinD, 1.15)); }

function head(p, L, skin, skinD, skinH, hair, hairH, hairD, opt) {
  const round = L.round ? 1 : 0;
  // ears
  p(-11 - round, 11, 3, 4, INK);
  p(-10 - round, 12, 2, 3, skinD);
  p(8 + round, 11, 3, 4, INK);
  p(8 + round, 12, 2, 3, skin);
  if (L.hoops) { p(-12, 13, 2, 2, '#e6c15a'); p(10, 13, 2, 2, '#e6c15a'); }
  // skull
  const bands = L.round
    ? [[5, 12], [2, 16], [1, 18], [0, 20], [0, 20], [0, 20], [0, 20], [0, 20], [0, 20], [1, 18], [2, 16], [4, 14], [6, 10]]
    : [[4, 12], [2, 15], [1, 17], [0, 18], [0, 18], [0, 18], [0, 18], [0, 18], [0, 18], [1, 17], [2, 15], [3, 13], [5, 10]];
  bands.forEach(([, w], i) => p(-Math.floor(w / 2) - 1, 4 + i, w + 2, 1, INK));
  bands.forEach(([, w], i) => {
    const col = i > 9 ? skinD : (i < 2 ? skinH : skin);
    p(-Math.floor(w / 2), 4 + i, w, 1, col);
  });
  p(5, 9, 2, 6, skinD);
  // scalp shine before hair, shows through on bald styles
  if (L.style === 'bald' || L.style === 'balding') p(-2, 6, 3, 2, sh(skin, 1.18));
  hairCap(p, L, hair, hairH, hairD, skinH);
  face(p, L, skin, skinD, opt);
}

function hairCap(p, L, hair, hairH, hairD, skinH) {
  const cap = () => {
    p(-8, 2, 16, 2, INK);
    p(-9, 3, 18, 5, INK);
    p(-8, 3, 16, 4, hair);
    p(-9, 4, 18, 3, hair);
    p(-7, 4, 4, 1, hairH);
  };
  switch (L.style) {
    case 'slick':
      cap();
      p(-5, 1, 10, 2, INK); p(-4, 1, 8, 2, hair);
      p(-6, 3, 3, 1, hairH); p(-1, 3, 1, 4, skinH); // part
      p(-9, 7, 2, 4, hair); p(7, 7, 2, 3, hairD);
      break;
    case 'messy':
      cap();
      p(-8, 0, 3, 3, hair); p(-3, -1, 3, 3, hair); p(2, 0, 4, 3, hair); p(6, 1, 3, 2, hairD);
      p(-9, 7, 2, 5, hair); p(7, 7, 2, 4, hair);
      p(-6, 3, 3, 1, hairH);
      break;
    case 'part':
      cap();
      p(-7, 3, 5, 3, hair); p(1, 3, 6, 3, hairD);
      p(-1, 3, 2, 4, skinH);
      p(-9, 7, 2, 4, hair); p(7, 7, 2, 3, hairD);
      p(-6, 4, 3, 1, hairH);
      break;
    case 'short':
      cap();
      p(-9, 7, 2, 3, hair); p(7, 7, 2, 2, hairD);
      p(-6, 3, 4, 1, hairH);
      break;
    case 'pony':
      cap();
      p(-8, 6, 6, 2, hair); // bangs swept
      p(-7, 4, 3, 1, hairH);
      p(-9, 7, 2, 4, hair);
      break;
    case 'bun':
      p(-4, -3, 8, 6, INK); p(-3, -2, 6, 4, hair); p(-2, -2, 2, 1, hairH);
      cap();
      p(-8, 6, 16, 2, hair);
      p(-6, 4, 4, 1, hairH);
      break;
    case 'curly':
      p(-14, 1, 28, 8, INK);
      p(-15, 5, 30, 8, INK);
      p(-13, 2, 26, 7, hair);
      p(-14, 6, 28, 6, hair);
      p(-12, 3, 5, 2, hairH);
      p(-2, 4, 3, 2, hairH);
      p(4, 6, 3, 2, hairD);
      p(-8, 7, 14, 2, hair); // fringe
      break;
    case 'bald':
      p(-10, 8, 3, 6, INK); p(7, 8, 3, 6, INK);
      p(-9, 9, 2, 4, hair); p(7, 9, 2, 4, hairD);
      p(-1, 6, 2, 1, '#fff6');
      break;
    case 'balding':
      p(-10, 5, 4, 9, INK); p(6, 5, 4, 9, INK);
      p(-9, 6, 3, 7, hair); p(6, 6, 3, 7, hairD);
      p(-4, 4, 8, 2, hair);
      p(-1, 6, 2, 1, sh('#efc7a5', 1.15));
      break;
    case 'chop':
      cap();
      p(-9, 1, 4, 3, hair); p(4, 0, 5, 3, hairD); p(-2, 1, 3, 2, hairH);
      p(-9, 7, 2, 4, hair); p(7, 7, 2, 3, hair);
      break;
    case 'long':
      cap();
      p(-7, 6, 14, 3, hair); // thick bangs
      p(-6, 4, 4, 1, hairH);
      break;
    case 'stringy':
      p(-7, 2, 10, 3, INK); p(-6, 3, 8, 2, hair); // receding
      p(-10, 6, 3, 6, hair); p(7, 6, 3, 5, hairD);
      p(-4, 3, 2, 1, hairH);
      break;
    default: cap();
  }
}

function ponyTail(p, hair, hairH, hairD) {
  p(8, 6, 5, 5, INK);
  p(9, 8, 6, 14, INK);
  p(8, 7, 4, 4, hair);
  p(9, 9, 4, 12, hairD);
  p(9, 10, 1, 8, hair);
  p(10, 8, 2, 2, hairH);
}

function longHair(p, hair, hairH, hairD) {
  p(-13, 8, 5, 24, INK); p(8, 8, 5, 24, INK);
  p(-12, 9, 4, 22, hair); p(8, 9, 4, 22, hairD);
  p(-12, 10, 1, 14, hairH);
  p(-11, 28, 2, 2, hairH);
}

function stringy(p, hair, hairH, hairD) {
  p(-12, 10, 3, 16, INK); p(9, 10, 3, 14, INK);
  p(-11, 11, 2, 14, hair); p(9, 11, 2, 12, hairD);
  p(-11, 18, 1, 4, hairH);
  p(-8, 12, 1, 6, hair); p(6, 14, 1, 5, hairD);
}

function curlySides(p, hair, hairH, hairD) {
  p(-16, 12, 6, 12, INK); p(10, 12, 6, 12, INK);
  p(-15, 13, 5, 10, hair); p(10, 13, 5, 10, hairD);
  p(-14, 14, 2, 3, hairH);
  p(-15, 20, 4, 4, hair); p(11, 20, 4, 4, hairD);
}

function face(p, L, skin, skinD, opt) {
  // brows sit just over the eyes
  const b = L.hair ? sh(L.hair, 0.55) : INK;
  if (L.brow === 'stern') { p(-7, 9, 4, 1, b); p(-5, 10, 2, 1, b); p(3, 10, 2, 1, b); p(3, 9, 4, 1, b); }
  else if (L.brow === 'sad') { p(-7, 10, 3, 1, b); p(-5, 9, 3, 1, b); p(2, 9, 3, 1, b); p(4, 10, 3, 1, b); }
  else if (L.brow === 'up') { p(-7, 8, 5, 1, b); p(2, 8, 5, 1, b); }
  else { p(-7, 9, 5, 1, b); p(2, 9, 5, 1, b); }
  if (L.fem && !opt.blink) { p(-7, 10, 5, 1, INK); p(2, 10, 5, 1, INK); }
  const blink = !!opt.blink;
  if (blink) {
    p(-7, 12, 5, 1, INK); p(2, 12, 5, 1, INK);
  } else if (L.sleepy) {
    p(-7, 11, 5, 3, '#f4f1ea'); p(2, 11, 5, 3, '#f4f1ea');
    p(-6, 12, 3, 2, EYE); p(3, 12, 3, 2, EYE);
    p(-6, 12, 1, 1, '#fff'); p(3, 12, 1, 1, '#fff');
    p(-7, 11, 5, 1, skin); p(2, 11, 5, 1, skin);
  } else {
    p(-7, 10, 5, 4, '#f7f4ee'); p(2, 10, 5, 4, '#f7f4ee');
    p(-6, 11, 3, 3, EYE); p(3, 11, 3, 3, EYE);
    p(-6, 11, 1, 1, '#fff'); p(3, 11, 1, 1, '#fff');
    // lower lid
    p(-7, 13, 5, 1, skinD); p(2, 13, 5, 1, skinD);
  }
  if (L.glasses) {
    const g = '#161616';
    p(-8, 10, 7, 1, g); p(1, 10, 7, 1, g);
    p(-8, 14, 7, 1, g); p(1, 14, 7, 1, g);
    p(-8, 10, 1, 5, g); p(-2, 10, 1, 5, g);
    p(1, 10, 1, 5, g); p(7, 10, 1, 5, g);
    p(-1, 12, 2, 1, g);
    p(-7, 11, 1, 2, 'rgba(255,255,255,.75)');
  }
  p(0, 14, 1, 2, skinD);
  if (L.blush) { p(-8, 14, 2, 1, 'rgba(214,96,96,.55)'); p(6, 14, 2, 1, 'rgba(214,96,96,.55)'); }
  const lip = '#8e3a34', lipH = '#d4847c';
  switch (L.mouth) {
    case 'grin':
      p(-4, 16, 8, 1, lip); p(-3, 17, 6, 2, '#f4f1ea'); p(-4, 17, 1, 1, lip); p(3, 17, 1, 1, lip); p(-3, 17, 6, 1, lipH);
      break;
    case 'smile':
      p(-3, 16, 6, 1, lip); p(-4, 15, 1, 1, lip); p(3, 15, 1, 1, lip); p(-2, 17, 4, 1, lipH);
      break;
    case 'smirk':
      p(-3, 16, 3, 1, lip); p(0, 15, 4, 1, lip); p(-2, 17, 2, 1, lipH);
      break;
    case 'frown':
      p(-3, 17, 6, 1, lip); p(-4, 16, 1, 1, lip); p(3, 16, 1, 1, lip);
      break;
    case 'creep':
      p(-4, 16, 3, 1, lip); p(0, 17, 4, 1, lip); p(2, 16, 1, 1, '#f4f1ea');
      break;
    default:
      p(-3, 16, 6, 1, '#6e342e');
  }
  if (L.stache) {
    p(-5, 15, 10, 2, L.stache);
    p(-6, 16, 2, 2, L.stache); p(4, 16, 2, 2, L.stache);
    p(-4, 15, 2, 1, sh(L.stache, 1.3));
  }
}
