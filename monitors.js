// Live desk monitors. Each bot's screen shows what that bot is actually doing:
//   Grok Bot (hero desk): the live HQ chat transcript (your messages + replies as they land), auto-scrolling.
//   Family Inbox: Chris's newest emails (sender, subject, time; lead/job alerts filtered) from an encrypted per-device feed.
//   Every other bot: its current task from tasks.json (busy) or a clear idle / roaming screen. No made-up activity.
// Data stays private: the transcript comes from this iPad's own HQ chat log (end-to-end encrypted relay), never a public file.
// Perf (iPad): canvases redraw on change or at most ~3 fps for the cursor/scroll animation, and only for desks within
// ~16 m of you (or the one you're focused on). The 3D loop just calls tick() every frame; it's time-gated inside.
import * as THREE from './vendor/three.module.js';

const FONT = 'system-ui,-apple-system,Segoe UI,Arial';
const HERO_W = 1024, HERO_H = 600, W = 768, H = 450;   // same 512:300 aspect as the monitor planes
const NEAR = 16, FRAME_MS = 330;
const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hm = t => { try { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

function wrap(g, text, maxW, maxLines = 99) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/)) {
      if (!word) continue;
      while (g.measureText(word).width > maxW) { // very long token (URL): hard split
        let k = word.length; while (k > 1 && g.measureText(word.slice(0, k)).width > maxW) k--;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, k)); word = word.slice(k);
      }
      const test = line ? line + ' ' + word : word;
      if (g.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  if (out.length > maxLines) { const cut = out.slice(0, maxLines); cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,2}$/, '…'); return cut; }
  return out;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function header(g, w, st, busy, label, hh) {
  const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, st.color); grd.addColorStop(1, '#1c2230');
  g.fillStyle = grd; g.fillRect(0, 0, w, hh);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillStyle = busy ? '#ffb74d' : '#7CFC9A'; g.beginPath(); g.arc(hh * 0.45, hh / 2, hh * 0.16, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.font = `800 ${Math.round(hh * 0.44)}px ${FONT}`; g.fillText(label, hh * 0.75, hh / 2 + 1);
  g.textAlign = 'right'; g.font = `600 ${Math.round(hh * 0.36)}px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(clock(), w - hh * 0.35, hh / 2 + 1);
}
function scan(g, w, h) { g.fillStyle = 'rgba(255,255,255,.035)'; for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1); }

// ---------- Grok Bot: live HQ chat ----------
function drawHero(g, s, m, t) {
  const w = HERO_W, h = HERO_H, hh = 64, foot = 52, pad = 26, maxW = w - pad * 2 - 40;
  g.fillStyle = '#10141c'; g.fillRect(0, 0, w, h);
  header(g, w, s, m.busy, 'GROK BOT · HQ CHAT LIVE', hh);
  const log = m.log || [];
  // footer status
  const last = log[log.length - 1];
  let status, col = '#9fb3c8';
  if (!log.length) status = 'Quiet. Hold View to message Grok Bot.';
  else if (last.kind === 'me' && last.status === 'sending') { status = 'Sending your message' + '.'.repeat(1 + (t / 400 | 0) % 3); col = '#ffd59a'; }
  else if (last.kind === 'me' && last.status === 'failed') { status = 'Last message not sent. Open chat to retry'; col = '#ff8a80'; }
  else if (last.kind === 'me' && Date.now() - last.at < 45 * 60000) {
    status = `Grok Bot is on it${last.issue ? ' (#' + last.issue + ')' : ''}` + '.'.repeat(1 + (t / 400 | 0) % 3) + `  ·  ${ago(last.at)}`; col = '#ffb74d';
  } else status = 'Waiting for your next message' + ((t / 530 | 0) % 2 ? ' _' : '');
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, h - foot, w, foot);
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `600 24px ${FONT}`; g.fillStyle = col; g.fillText(status, pad, h - foot / 2);
  // messages, newest at the bottom, laid out upward
  g.save(); g.beginPath(); g.rect(0, hh, w, h - hh - foot); g.clip();
  let y = h - foot - 14 + (m.scroll || 0);
  for (let i = log.length - 1; i >= 0 && y > hh; i--) {
    const e = log[i], me = e.kind === 'me';
    g.font = `500 29px ${FONT}`;
    const lines = wrap(g, e.text, maxW - 24, 12), lh = 37;
    const who = me ? `You → ${e.to || 'Grok Bot'}` : (e.from || 'Grok Bot'), stamp = hm(e.at) + (me && e.issue ? ` · #${e.issue}` : '');
    const textW = Math.max(...lines.map(l => g.measureText(l).width));
    g.font = `700 21px ${FONT}`; const headW = g.measureText(who).width + 30 + (g.font = `500 19px ${FONT}`, g.measureText(stamp).width);
    const bh = lines.length * lh + 50, bw = Math.min(maxW, Math.max(textW, headW, 200) + 32);
    y -= bh; const x = me ? w - pad - bw : pad;
    rr(g, x, y, bw, bh - 10, 14); g.fillStyle = me ? 'rgba(232,163,61,.20)' : 'rgba(110,160,255,.16)'; g.fill();
    g.fillStyle = me ? '#ffcf86' : '#9cc3ff'; g.font = `700 21px ${FONT}`; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText(who, x + 16, y + 9);
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `500 19px ${FONT}`;
    g.fillText(stamp, x + bw - 14, y + 11);
    g.textAlign = 'left'; g.fillStyle = '#eef2f7'; g.font = `500 29px ${FONT}`;
    lines.forEach((l, k) => g.fillText(l, x + 16, y + 38 + k * lh));
  }
  g.restore();
  const fade = g.createLinearGradient(0, hh, 0, hh + 40); fade.addColorStop(0, '#10141c'); fade.addColorStop(1, 'rgba(16,20,28,0)');
  g.fillStyle = fade; g.fillRect(0, hh, w, 40);
  scan(g, w, h);
}

// ---------- other bots: task or idle ----------
function drawDesk(g, s, m, t) {
  const w = W, h = H, hh = 58, pad = 30;
  g.fillStyle = '#121620'; g.fillRect(0, 0, w, h);
  header(g, w, s, m.busy, (m.busy ? 'WORKING · ' : 'IDLE · ') + s.short, hh);
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 28px ${FONT}`; g.fillText(s.name, pad, hh + 16);
  if (m.busy) {
    g.fillStyle = '#ffb74d'; g.font = `800 20px ${FONT}`; g.fillText('CURRENT TASK', pad, hh + 62);
    g.fillStyle = '#fff'; g.font = `700 44px ${FONT}`;
    const lines = wrap(g, m.task || 'On a task', w - pad * 2 - 30, 5);
    lines.forEach((l, k) => g.fillText(l, pad, hh + 92 + k * 54));
    // blinking cursor after the last line
    if ((t / 530 | 0) % 2) { const lw = g.measureText(lines[lines.length - 1]).width; g.fillStyle = '#ffb74d'; g.fillRect(pad + lw + 8, hh + 96 + (lines.length - 1) * 54, 18, 42); }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 22px ${FONT}`; g.textBaseline = 'bottom';
    const bits = [m.since ? `At desk ${ago(m.since)}` : 'At desk'];
    if (m.until) bits.push(`until ${hm(m.until)}`);
    g.fillText(bits.join('  ·  '), pad, h - 22);
  } else {
    g.fillStyle = s.color; g.globalAlpha = 0.22; g.font = `900 ${s.short.length > 3 ? 120 : 150}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.short, w / 2, h / 2 + 30); g.globalAlpha = 1;
    g.fillStyle = '#7CFC9A'; g.font = `800 44px ${FONT}`; g.fillText('Idle · roaming the floor', w / 2, h / 2 + 10);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 27px ${FONT}`; g.fillText('No task right now. Ready when you need it.', w / 2, h / 2 + 66);
  }
  scan(g, w, h);
}

// ---------- Family Inbox: Chris's real inbox (headers only, lead/job mail filtered; encrypted feed) ----------
function drawInbox(g, s, m, t) {
  const w = W, h = H, hh = 58, pad = 22, foot = 40, f = m.inbox;
  g.fillStyle = '#121620'; g.fillRect(0, 0, w, h);
  header(g, w, s, m.busy, 'INBOX LIVE · ' + s.short, hh);
  const items = f.items || [], rowH = 50, top = hh + 6, rows = Math.min(items.length, Math.floor((h - top - foot) / rowH));
  g.textBaseline = 'middle';
  if (!items.length) { g.textAlign = 'center'; g.fillStyle = '#7CFC9A'; g.font = `800 40px ${FONT}`; g.fillText('Inbox clear', w / 2, h / 2); }
  for (let i = 0; i < rows; i++) {
    const e = items[i], y = top + i * rowH;
    if (i % 2) { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, y, w, rowH); }
    if (e.u) { g.fillStyle = s.color; g.beginPath(); g.arc(pad - 8, y + rowH / 2, 5, 0, 7); g.fill(); }
    const when = Date.now() - e.t < 20 * 3600e3 ? hm(e.t) : new Date(e.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 19px ${FONT}`; g.fillText(when, w - pad, y + 15);
    g.textAlign = 'left'; g.fillStyle = e.u ? '#fff' : 'rgba(255,255,255,.75)'; g.font = `${e.u ? 800 : 600} 20px ${FONT}`;
    g.fillText(wrap(g, e.f, w - pad * 2 - 120, 1)[0], pad + 4, y + 15);
    g.fillStyle = e.u ? '#dfe6ee' : 'rgba(255,255,255,.6)'; g.font = `500 20px ${FONT}`;
    g.fillText(wrap(g, e.s, w - pad * 2 - 6, 1)[0], pad + 4, y + 36);
  }
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, h - foot, w, foot);
  g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `500 18px ${FONT}`;
  const unread = items.filter(e => e.u).length;
  g.fillText(`${unread} unread · ${f.leads || 0} lead/job alerts hidden · updated ${ago(f.at)}${ago(f.at) === 'just now' ? '' : ' ago'}`, pad, h - foot / 2);
  if (m.busy && m.task) { g.textAlign = 'right'; g.fillStyle = '#ffb74d'; g.font = `600 18px ${FONT}`; g.fillText(wrap(g, m.task, 220, 1)[0], w - pad, h - foot / 2); }
  scan(g, w, h);
}

export function createMonitors({ stations }) {
  const mons = new Map();
  for (const s of stations) {
    const c = document.createElement('canvas'); c.width = s.hero ? HERO_W : W; c.height = s.hero ? HERO_H : H;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const old = s.screen.material.map; s.screen.material.map = tex; s.screen.material.needsUpdate = true; old?.dispose?.();
    const m = { s, c, g: c.getContext('2d'), tex, busy: false, task: '', since: 0, until: '', log: [], dirty: true, last: 0, scroll: 0, sig: '' };
    mons.set(s.id, m); draw(m, performance.now());
  }
  const INBOX_STALE = 36 * 3600e3; // older feed than this: fall back to the task screen
  function draw(m, t) { (m.s.hero ? drawHero : m.inbox && Date.now() - m.inbox.at < INBOX_STALE ? drawInbox : drawDesk)(m.g, m.s, m, t); m.tex.needsUpdate = true; m.last = t; m.dirty = false; }
  function animated(m, d, focused) {
    if (m.scroll > 0.5) return true;
    if (m.s.hero) return d < 10 || focused; // status dots / cursor
    return m.busy && (d < 7 || focused);    // blinking cursor while working, only up close
  }
  let lastMinute = -1, nextAt = 0;
  return {
    canvas: id => mons.get(id)?.c,
    setStatus(id, busy, task, since, until) {
      const m = mons.get(id); if (!m) return;
      if (busy && !m.busy) m.since = since ? Date.parse(since) || Date.now() : Date.now();
      if (busy && since) m.since = Date.parse(since) || m.since;
      Object.assign(m, { busy, task: busy ? task : '', until: busy ? until || '' : '', dirty: true });
    },
    // Family Inbox desk: decrypted feed from hq-link.fetchInboxFeed()
    setInbox(id, feed) {
      const m = mons.get(id); if (!m || !feed) return;
      const sig = JSON.stringify([feed.at, feed.items]); if (sig === m.isig) return;
      m.isig = sig; m.inbox = feed; m.dirty = true;
    },
    // HQ chat log from chat.js (this device's own encrypted chat history)
    setLog(entries) {
      const m = [...mons.values()].find(x => x.s.hero); if (!m) return;
      const log = entries.slice(-30).map(e => ({ kind: e.kind, text: e.text, to: e.to, from: e.from, at: e.at, status: e.status, issue: e.issue }));
      const sig = JSON.stringify(log); if (sig === m.sig) return;
      const grew = log.length > m.log.length || (log.length && m.log.length && log[log.length - 1].at !== m.log[m.log.length - 1].at);
      m.sig = sig; m.log = log; m.dirty = true;
      if (grew && m.log.length > 1) m.scroll = 110; // new line slides up into place
    },
    tick(now, pos, focusedId) {
      if (now < nextAt) return; nextAt = now + FRAME_MS;
      const min = new Date().getMinutes(); const minuteTick = min !== lastMinute; lastMinute = min;
      for (const m of mons.values()) {
        const focused = m.s.id === focusedId, d = Math.hypot(m.s.x - pos.x, m.s.z - pos.z), near = focused || d < NEAR;
        if (minuteTick) m.dirty = true; // header clock / "at desk N min"
        if (!near) continue;
        if (m.scroll > 0.5) m.scroll *= 0.45; else m.scroll = 0;
        if (m.dirty || animated(m, d, focused)) draw(m, now);
      }
    },
  };
}
