// Full-wall whiteboard in the conference room (south wall). Looks hand-drawn in marker, but it's a live widget screen:
// a canvas texture redrawn only when data changes (iPad-friendly, no per-frame work).
// Widgets: clock (CT), live weather (Open-Meteo, keyless), live markets (CNBC public quote feed, keyless + CORS-open),
// team status (tasks.json, same file the workers use) and a bank placeholder (NOT connected; nothing is fetched until Chris says go).
import * as THREE from './vendor/three.module.js';
import { STATIONS } from './stations.js';

const PLACE = { name: 'Blue Ridge, TX', lat: 33.30, lon: -96.40 }; // Blue Ridge / Celina TX area
const WX_URL = `https://api.open-meteo.com/v1/forecast?latitude=${PLACE.lat}&longitude=${PLACE.lon}`
  + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
  + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=5';
const WATCH = [ // [symbol, label] — 3 index ETFs + 5 liquid names
  ['SPY', 'SPY'], ['QQQ', 'QQQ'], ['DIA', 'DIA'], ['AAPL', 'AAPL'], ['MSFT', 'MSFT'], ['NVDA', 'NVDA'], ['AMZN', 'AMZN'], ['TSLA', 'TSLA']];
const MKT_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols='
  + encodeURIComponent(WATCH.map(w => w[0]).join('|')) + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json';
const MKT_OPEN_MS = 3 * 60 * 1000;     // market hours
const MKT_SLOW_MS = 20 * 60 * 1000;    // pre/after hours, nights, weekends
const TASKS_MS = 60 * 1000;            // team status
const TZ = 'America/Chicago';
const FETCH_MS = 10 * 60 * 1000;   // weather refresh while in-game
const RETRY_MS = 60 * 1000;        // after a failed fetch
const CW = 2560, CH = 572;         // canvas matches the board's aspect (11.4 m x 2.55 m)
const FONT = '"Marker Felt", "Chalkboard SE", Noteworthy, "Segoe Print", "Comic Sans MS", cursive';
const INK = { black: '#1f2328', blue: '#1d4fb8', red: '#c8322b', green: '#1f7a3a', orange: '#d9761c', grey: '#7a7f86' };

// ---------- hand-drawn helpers (seeded so the wobble stays put between redraws) ----------
function rng(seed) { let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) | 0; return () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 16) & 0x7fff) / 0x7fff; }; }
function pen(g, color, width) { g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width; g.lineCap = g.lineJoin = 'round'; }
function line(g, x1, y1, x2, y2, seed, wob = 3) {
  const r = rng(seed + ':' + x1 + y1), len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.round(len / 60));
  const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
  g.beginPath(); g.moveTo(x1 + (r() - 0.5) * wob, y1 + (r() - 0.5) * wob);
  for (let i = 1; i <= n; i++) { const t = i / n, o = (r() - 0.5) * wob * 2; g.lineTo(x1 + (x2 - x1) * t + nx * o, y1 + (y2 - y1) * t + ny * o); }
  g.stroke();
}
function rect(g, x, y, w, h, seed, wob = 3) {
  line(g, x - 4, y, x + w + 5, y + 1, seed + 'a', wob); line(g, x + w, y - 3, x + w - 1, y + h + 4, seed + 'b', wob);
  line(g, x + w + 3, y + h, x - 3, y + h - 1, seed + 'c', wob); line(g, x + 1, y + h + 3, x, y - 4, seed + 'd', wob);
}
function dashed(g, x, y, w, h, seed) {
  const seg = (x1, y1, x2, y2, k) => { const L = Math.hypot(x2 - x1, y2 - y1), n = Math.floor(L / 34);
    for (let i = 0; i < n; i += 2) line(g, x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, x1 + (x2 - x1) * (i + 1) / n, y1 + (y2 - y1) * (i + 1) / n, seed + k + i, 2); };
  seg(x, y, x + w, y, 't'); seg(x + w, y, x + w, y + h, 'r'); seg(x + w, y + h, x, y + h, 'b'); seg(x, y + h, x, y, 'l');
}
function circle(g, cx, cy, rad, seed, wob = 3) {
  const r = rng(seed); g.beginPath();
  const a0 = r() * 6.28, n = 28;
  for (let i = 0; i <= n + 2; i++) { const a = a0 + (i / n) * Math.PI * 2, rr = rad + (r() - 0.5) * wob * 2 + (i > n ? 4 : 0); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.stroke();
}
function text(g, s, x, y, size, color, { align = 'left', tilt = 0, weight = '' } = {}) {
  g.save(); g.translate(x, y); g.rotate(tilt); g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.strokeStyle = color; g.lineWidth = Math.max(1.5, size / 22); g.lineJoin = 'round'; g.strokeText(s, 0, 0); // marker-thick strokes
  g.fillText(s, 0, 0); g.restore();
}
function tape(g, x, y, w, rot) {
  g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = 'rgba(236,224,170,.78)'; g.fillRect(-w / 2, -14, w, 28);
  g.strokeStyle = 'rgba(160,140,90,.35)'; g.lineWidth = 1; g.strokeRect(-w / 2, -14, w, 28); g.restore();
}

// ---------- weather icons, drawn like marker doodles ----------
function wxKind(code, day = 1) {
  if (code === 0 || code === 1) return day ? 'sun' : 'moon';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  return 'cloud';
}
const WX_WORDS = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow',
  75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms',
  96: 'Storms + hail', 99: 'Storms + hail' };
function cloudShape(g, cx, cy, s, seed) {
  const r = rng(seed); g.beginPath();
  const bumps = [[-0.55, 0.1, 0.32], [-0.2, -0.18, 0.42], [0.25, -0.1, 0.36], [0.55, 0.12, 0.28]];
  for (const [bx, by, br] of bumps) { const rr = br * s * (0.95 + r() * 0.1); g.moveTo(cx + bx * s + rr, cy + by * s); g.arc(cx + bx * s, cy + by * s, rr, 0, Math.PI * 2); }
  g.save(); g.fillStyle = '#ffffff'; g.fill(); g.restore(); g.stroke();
  g.save(); g.fillStyle = '#ffffff'; g.fillRect(cx - 0.8 * s, cy + 0.05 * s, 1.6 * s, 0.32 * s); g.restore();
  line(g, cx - 0.85 * s, cy + 0.38 * s, cx + 0.83 * s, cy + 0.38 * s, seed + 'base', 3);
}
function icon(g, kind, cx, cy, s, seed) {
  const sun = (x, y, rr, col) => { pen(g, col, s * 0.07); circle(g, x, y, rr, seed + 's');
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.2; line(g, x + Math.cos(a) * rr * 1.35, y + Math.sin(a) * rr * 1.35, x + Math.cos(a) * rr * 1.8, y + Math.sin(a) * rr * 1.8, seed + 'ray' + i, 2); } };
  if (kind === 'sun') return sun(cx, cy, s * 0.42, INK.orange);
  if (kind === 'moon') { // crescent: filled disc, bite taken out in board colour, wobbly outline
    g.save(); g.fillStyle = '#f2c94c'; g.beginPath(); g.arc(cx, cy, s * 0.46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f6f6f1'; g.beginPath(); g.arc(cx + s * 0.26, cy - s * 0.12, s * 0.4, 0, Math.PI * 2); g.fill(); g.restore();
    pen(g, INK.orange, s * 0.05); g.beginPath(); g.arc(cx, cy, s * 0.46, 0.55, 5.0); g.stroke();
    pen(g, INK.orange, s * 0.04); for (const [dx, dy] of [[-0.7, -0.5], [0.75, -0.65], [0.6, 0.55]]) { line(g, cx + dx * s - 9, cy + dy * s, cx + dx * s + 9, cy + dy * s, seed + dx, 1); line(g, cx + dx * s, cy + dy * s - 9, cx + dx * s, cy + dy * s + 9, seed + dy, 1); } return; }
  if (kind === 'partly') { sun(cx + s * 0.3, cy - s * 0.3, s * 0.3, INK.orange); pen(g, INK.black, s * 0.06); return cloudShape(g, cx - s * 0.1, cy + s * 0.15, s * 0.85, seed + 'c'); }
  pen(g, INK.black, s * 0.06); cloudShape(g, cx, cy - s * 0.12, s, seed + 'c');
  if (kind === 'rain') { pen(g, INK.blue, s * 0.06); for (let i = 0; i < 4; i++) line(g, cx - s * 0.5 + i * s * 0.33, cy + s * 0.42, cx - s * 0.6 + i * s * 0.33, cy + s * 0.7, seed + 'r' + i, 2); }
  if (kind === 'snow') { pen(g, INK.blue, s * 0.045); for (let i = 0; i < 3; i++) { const x = cx - s * 0.45 + i * s * 0.45, y = cy + s * 0.6; for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; line(g, x - Math.cos(a) * 11, y - Math.sin(a) * 11, x + Math.cos(a) * 11, y + Math.sin(a) * 11, seed + i + k, 1); } } }
  if (kind === 'storm') { pen(g, INK.orange, s * 0.07); g.beginPath(); g.moveTo(cx + s * 0.05, cy + s * 0.3); g.lineTo(cx - s * 0.15, cy + s * 0.58); g.lineTo(cx + s * 0.08, cy + s * 0.56); g.lineTo(cx - s * 0.1, cy + s * 0.9); g.stroke(); }
  if (kind === 'fog') { pen(g, INK.grey, s * 0.06); for (let i = 0; i < 3; i++) line(g, cx - s * 0.8 + i * 10, cy + s * 0.45 + i * s * 0.17, cx + s * 0.75 - i * 6, cy + s * 0.45 + i * s * 0.17, seed + 'f' + i, 3); }
}

// ---------- time helpers ----------
const fmtTime = (t, o = {}) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', ...o });
function nyParts(t = Date.now()) { // market session in New York time
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const mins = (+p.hour % 24) * 60 + +p.minute, wk = !['Sat', 'Sun'].includes(p.weekday);
  return { mins, wk, open: wk && mins >= 570 && mins < 960, ext: wk && mins >= 240 && mins < 1200 };
}
const fit = (g, s, size, maxW) => { g.font = `${size}px ${FONT}`; if (g.measureText(s).width <= maxW) return s;
  while (s.length > 2 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s.trimEnd() + '…'; };
const num = s => parseFloat(String(s ?? '').replace(/[,%+$]/g, ''));

// ---------- the board drawing ----------
function draw(g, st) {
  const { wx, wxStatus, mkt, mktStatus, team } = st, now = Date.now();
  // board surface: off-white with faint ghosting from old erased marker
  g.fillStyle = '#f6f6f1'; g.fillRect(0, 0, CW, CH);
  const ghost = rng('ghost'); g.globalAlpha = 0.05; pen(g, '#4a5560', 14);
  for (let i = 0; i < 9; i++) { const x = ghost() * CW, y = ghost() * CH; line(g, x, y, x + 120 + ghost() * 260, y + (ghost() - 0.5) * 60, 'g' + i, 10); }
  g.globalAlpha = 1;

  // title
  text(g, 'HQ BOARD', 46, 92, 76, INK.black, { tilt: -0.015 });
  pen(g, INK.red, 7); line(g, 44, 112, 400, 106, 'title-ul', 4);

  // ---- clock (CT) ----
  { const cx = 520, cy = 68, r = 46;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(now)).map(x => [x.type, x.value]));
    const h = +p.hour % 12, m = +p.minute;
    pen(g, INK.black, 5); circle(g, cx, cy, r, 'clock', 2);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; line(g, cx + Math.sin(a) * r * 0.8, cy - Math.cos(a) * r * 0.8, cx + Math.sin(a) * r * 0.92, cy - Math.cos(a) * r * 0.92, 'tick' + i, 1); }
    const ah = (h + m / 60) * Math.PI / 6, am = m * Math.PI / 30;
    pen(g, INK.black, 6); line(g, cx, cy, cx + Math.sin(ah) * r * 0.5, cy - Math.cos(ah) * r * 0.5, 'hh', 1);
    pen(g, INK.red, 4); line(g, cx, cy, cx + Math.sin(am) * r * 0.78, cy - Math.cos(am) * r * 0.78, 'mh', 1);
    text(g, fmtTime(now), cx + 72, 94, 70, INK.black, { tilt: -0.01 });
    text(g, new Date(now).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' }) + ' · CT', cx + 380, 90, 40, INK.blue, { tilt: -0.01 });
  }
  text(g, 'want another widget? ask Grok in HQ chat :)', CW - 40, 84, 30, INK.grey, { align: 'right', tilt: -0.01 });

  // ---- weather widget ----
  const wx0 = 40, wy0 = 140, ww = 1010, wh = 400;
  pen(g, INK.blue, 6); rect(g, wx0, wy0, ww, wh, 'wxbox', 4);
  text(g, `WEATHER · ${PLACE.name}`, wx0 + 28, wy0 + 58, 42, INK.blue, { tilt: -0.01 });
  if (wx) {
    const c = wx.current, d = wx.daily;
    text(g, `today ↑${Math.round(d.temperature_2m_max[0])}° ↓${Math.round(d.temperature_2m_min[0])}° · rain ${d.precipitation_probability_max[0] ?? 0}%`, wx0 + 30, wy0 + 112, 32, INK.red, { tilt: -0.01 });
    icon(g, wxKind(c.weather_code, c.is_day), wx0 + 105, wy0 + 215, 96, 'now' + c.weather_code);
    text(g, `${Math.round(c.temperature_2m)}°`, wx0 + 200, wy0 + 268, 150, INK.black, { tilt: -0.02 });
    text(g, fit(g, WX_WORDS[c.weather_code] || '—', 38, 450), wx0 + 30, wy0 + 330, 38, INK.black);
    text(g, `feels ${Math.round(c.apparent_temperature)}° · wind ${Math.round(c.wind_speed_10m)} · ${Math.round(c.relative_humidity_2m)}%rh`, wx0 + 30, wy0 + 372, 26, INK.grey);
    pen(g, INK.grey, 3); line(g, wx0 + 500, wy0 + 90, wx0 + 498, wy0 + 380, 'wxdiv', 4);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 1; i < Math.min(5, d.time.length); i++) {
      const x = wx0 + 580 + (i - 1) * 118, dt = new Date(d.time[i] + 'T12:00:00');
      text(g, days[dt.getDay()], x, wy0 + 128, 36, INK.black, { align: 'center' });
      icon(g, wxKind(d.weather_code[i]), x, wy0 + 195, 44, 'd' + i + d.weather_code[i]);
      text(g, `${Math.round(d.temperature_2m_max[i])}°`, x, wy0 + 290, 38, INK.red, { align: 'center' });
      text(g, `${Math.round(d.temperature_2m_min[i])}°`, x, wy0 + 333, 32, INK.blue, { align: 'center' });
      if ((d.precipitation_probability_max[i] ?? 0) >= 20) text(g, `${d.precipitation_probability_max[i]}%💧`, x, wy0 + 372, 26, INK.blue, { align: 'center' });
    }
  } else {
    text(g, wxStatus === 'error' ? 'weather offline — retrying…' : 'checking the sky…', wx0 + 40, wy0 + 230, 52, INK.grey, { tilt: -0.02 });
  }
  text(g, wx ? `${fmtTime(wx.at)} CT${wxStatus === 'error' ? ' · stale' : ''}` : '', wx0 + ww - 24, wy0 + 52, 22, INK.grey, { align: 'right' });

  // ---- markets widget ----
  const mx = 1080, my = 140, mw = 760, mh = 400;
  pen(g, INK.black, 6); rect(g, mx, my, mw, mh, 'mktbox', 4);
  text(g, 'MARKETS', mx + 28, my + 58, 42, INK.black, { tilt: -0.01 });
  const ses = nyParts(now);
  const sesTxt = ses.open ? 'market OPEN' : ses.ext ? (ses.mins < 570 ? 'pre-market' : 'after hours') : 'market closed';
  text(g, sesTxt, mx + 250, my + 56, 30, ses.open ? INK.green : INK.orange, { tilt: -0.02 });
  if (ses.open) { g.fillStyle = INK.green; g.beginPath(); g.arc(mx + 236, my + 46, 7, 0, 7); g.fill(); }
  if (mkt && mkt.rows.length) {
    let y = my + 104;
    mkt.rows.forEach((q, i) => {
      if (i === 3) { pen(g, INK.grey, 2); line(g, mx + 26, y - 26, mx + mw - 26, y - 27, 'mktdiv', 3); y += 8; }
      const up = q.chg >= 0, col = isNaN(q.chg) ? INK.grey : up ? INK.green : INK.red;
      text(g, q.label, mx + 30, y, 30, i < 3 ? INK.blue : INK.black);
      text(g, isNaN(q.last) ? '—' : q.last.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), mx + 300, y, 30, INK.black, { align: 'right' });
      text(g, isNaN(q.pct) ? '' : `${up ? '▲' : '▼'} ${Math.abs(q.pct).toFixed(2)}%`, mx + 470, y, 28, col, { align: 'right' });
      if (q.lo < q.hi && !isNaN(q.last)) { // day range, low → high, dot = last
        const x0 = mx + 500, x1 = mx + mw - 40, t = Math.min(1, Math.max(0, (q.last - q.lo) / (q.hi - q.lo)));
        pen(g, INK.grey, 3); line(g, x0, y - 10, x1, y - 10, 'rg' + i, 2);
        line(g, x0, y - 18, x0, y - 2, 'rl' + i, 1); line(g, x1, y - 18, x1, y - 2, 'rh' + i, 1);
        g.fillStyle = col; g.beginPath(); g.arc(x0 + (x1 - x0) * t, y - 10, 8, 0, 7); g.fill();
      }
      y += 36;
    });
    text(g, 'day range', mx + mw - 40, my + 82, 20, INK.grey, { align: 'right' });
    text(g, `as of ${mkt.asof || fmtTime(mkt.at)} · updated ${fmtTime(mkt.at)} CT${mktStatus === 'error' ? ' · stale' : ''}`, mx + 30, my + mh - 14, 20, INK.grey);
  } else {
    text(g, mktStatus === 'error' ? 'quotes offline — retrying…' : 'pulling quotes…', mx + 40, my + 230, 48, INK.grey, { tilt: -0.02 });
  }

  // ---- team status (tasks.json) ----
  const tx = 1870, ty = 140, tw = 390, th = 400;
  pen(g, INK.orange, 6); rect(g, tx, ty, tw, th, 'teambox', 4);
  text(g, 'TEAM ON IT', tx + 24, ty + 58, 40, INK.orange, { tilt: -0.01 });
  if (team === null) text(g, 'checking…', tx + 30, ty + 140, 34, INK.grey);
  else if (!team.length) text(g, 'all roaming — no tasks', tx + 30, ty + 140, 30, INK.grey);
  else {
    const max = team.length > 7 ? 6 : 7;
    team.slice(0, max).forEach((b, i) => {
      const y = ty + 108 + i * 40;
      g.fillStyle = b.color; g.beginPath(); g.arc(tx + 34, y - 9, 9, 0, 7); g.fill();
      text(g, b.short, tx + 52, y, 26, INK.black);
      text(g, fit(g, b.task, 24, tw - 150), tx + 130, y, 24, INK.grey);
    });
    if (team.length > max) text(g, `+${team.length - max} more`, tx + 52, ty + 108 + max * 40, 24, INK.grey);
  }

  // ---- bank placeholder (NOT connected) ----
  const bx = 2290, by = 140, bw = 240, bh = 400;
  pen(g, INK.green, 5); dashed(g, bx, by, bw, bh, 'bank');
  text(g, 'BANK', bx + 24, by + 60, 44, INK.green, { tilt: -0.01 });
  text(g, 'connect when', bx + 24, by + 116, 28, INK.green);
  text(g, 'Chris says go', bx + 24, by + 152, 28, INK.green);
  text(g, '$ — — —', bx + 24, by + 250, 46, 'rgba(31,122,58,.35)');
  text(g, 'not linked', bx + 24, by + 320, 24, INK.grey);
  text(g, 'placeholder', bx + bw - 20, by + bh - 20, 22, INK.grey, { align: 'right', tilt: -0.02 });

  // tape on the board corners
  tape(g, 30, 22, 90, -0.6); tape(g, CW - 30, 22, 90, 0.6);
}

export function createWhiteboard({ scene, x0, x1, y0, y1, z, std, box }) {
  const W = x1 - x0, H = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  // aluminium frame + backing + marker tray, on the wall (board faces -z, into the conference room)
  const frame = std('#b9bec4', 0.35, 0.7);
  box(W + 0.12, H + 0.12, 0.04, std('#e9e9e4', 0.5), cx, cy, z + 0.03, scene, false);
  box(W + 0.14, 0.05, 0.06, frame, cx, y1 + 0.04, z, scene, false); box(W + 0.14, 0.05, 0.06, frame, cx, y0 - 0.04, z, scene, false);
  box(0.05, H + 0.12, 0.06, frame, x0 - 0.045, cy, z, scene, false); box(0.05, H + 0.12, 0.06, frame, x1 + 0.045, cy, z, scene, false);
  box(W * 0.5, 0.04, 0.12, frame, cx, y0 - 0.08, z - 0.06, scene, false); // marker tray
  for (const [dx, c] of [[-0.6, '#1d4fb8'], [-0.45, '#c8322b'], [-0.3, '#1f2328'], [-0.15, '#1f7a3a']]) { // markers in the tray
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 10), std(c, 0.5)); m.rotation.z = Math.PI / 2; m.position.set(cx + dx, y0 - 0.045, z - 0.07); scene.add(m);
  }
  // the live surface: lit like a real board (standard material) with a touch of self-glow so it stays readable
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22 });
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  surf.rotation.y = Math.PI; surf.position.set(cx, cy, z - 0.002); surf.receiveShadow = true; scene.add(surf);

  const st = { wx: null, wxStatus: 'loading', mkt: null, mktStatus: 'loading', team: null };
  // throttled redraw: coalesce bursts, at most one canvas upload per second, none while the app is hidden
  let lastDraw = 0, drawTimer = 0, dirty = false;
  const redraw = () => {
    dirty = true; if (drawTimer) return;
    if (document.hidden) return;
    drawTimer = setTimeout(() => { drawTimer = 0; if (document.hidden) return; dirty = false; lastDraw = Date.now(); draw(g, st); tex.needsUpdate = true; }, Math.max(0, 1000 - (Date.now() - lastDraw)));
  };

  // weather
  let lastWx = 0, wxTimer = 0;
  async function fetchWx() {
    clearTimeout(wxTimer);
    if (document.hidden) return; // resume on visibilitychange
    lastWx = Date.now();
    try {
      const r = await fetch(WX_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.current || !j.daily) throw new Error('bad data');
      st.wx = { current: j.current, daily: j.daily, at: Date.now() }; st.wxStatus = 'ok';
      wxTimer = setTimeout(fetchWx, FETCH_MS);
    } catch (e) { st.wxStatus = 'error'; wxTimer = setTimeout(fetchWx, RETRY_MS); }
    redraw();
  }

  // markets (CNBC public quote feed: no key, Access-Control-Allow-Origin: *)
  let lastMkt = 0, mktTimer = 0;
  const mktEvery = () => (nyParts().open ? MKT_OPEN_MS : MKT_SLOW_MS);
  async function fetchMkt() {
    clearTimeout(mktTimer);
    if (document.hidden) return;
    lastMkt = Date.now();
    try {
      const r = await fetch(MKT_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = (await r.json())?.FormattedQuoteResult?.FormattedQuote || [];
      const by = Object.fromEntries(list.map(q => [q.symbol, q]));
      const rows = WATCH.map(([sym, label]) => { const q = by[sym] || {};
        return { label, last: num(q.last), chg: num(q.change), pct: num(q.change_pct), lo: num(q.low), hi: num(q.high) }; });
      if (!rows.some(x => !isNaN(x.last))) throw new Error('no quotes');
      const lt = by.SPY?.last_timedate || '';
      st.mkt = { rows, at: Date.now(), asof: /\d\d\/\d\d\/\d\d/.test(lt) ? 'close ' + lt.slice(0, 5).replace(/^0/, '') : lt.replace(/ E[DS]T$/, ' ET') };
      st.mktStatus = 'ok'; mktTimer = setTimeout(fetchMkt, mktEvery());
    } catch (e) { st.mktStatus = 'error'; mktTimer = setTimeout(fetchMkt, RETRY_MS * 2); }
    redraw();
  }

  // team status: busy bots from tasks.json (honours "until" like workers.js)
  const byId = Object.fromEntries(STATIONS.map(s => [s.id, s]));
  let lastTeam = 0;
  async function fetchTeam() {
    if (document.hidden) return;
    lastTeam = Date.now();
    try {
      const r = await fetch('./tasks.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const busy = (await r.json()).busy || {};
      const team = [];
      for (const [id, v] of Object.entries(busy)) {
        const s = byId[id]; if (!s) continue;
        const task = typeof v === 'string' ? v : v?.task; const until = typeof v === 'object' ? v?.until : null;
        if (!task || (until && Date.parse(until) < Date.now())) continue;
        team.push({ short: s.short, color: s.color, task, hero: !!s.hero });
      }
      team.sort((a, b) => b.hero - a.hero);
      const sig = JSON.stringify(team);
      if (sig !== JSON.stringify(st.team)) { st.team = team; redraw(); }
    } catch (e) { if (st.team === null) { st.team = []; redraw(); } }
  }
  setInterval(fetchTeam, TASKS_MS);

  // clock: redraw on each minute boundary
  const tick = () => { redraw(); setTimeout(tick, 60000 - (Date.now() % 60000) + 50); };
  setTimeout(tick, 60000 - (Date.now() % 60000) + 50);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Date.now() - lastWx > FETCH_MS) fetchWx();
    if (Date.now() - lastMkt > mktEvery()) fetchMkt();
    if (Date.now() - lastTeam > TASKS_MS) fetchTeam();
    redraw(); // clock catch-up
  });
  draw(g, st); tex.needsUpdate = true; lastDraw = Date.now();
  fetchWx(); fetchMkt(); fetchTeam();
  // redraw once more after fonts settle (Marker Felt etc. are system fonts on iPad, but be safe)
  document.fonts?.ready?.then(redraw).catch(() => {});
  return { canvas, refresh: () => { fetchWx(); fetchMkt(); fetchTeam(); }, get weather() { return st.wx; }, get markets() { return st.mkt; }, get team() { return st.team; }, get status() { return st.wxStatus; } };
}
