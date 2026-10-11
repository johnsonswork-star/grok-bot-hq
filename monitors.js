// Live desk monitors. Each bot's screen shows what that bot is actually doing:
//   Grok Bot (hero desk): the live HQ chat transcript (your messages + replies as they land), auto-scrolling.
//   Family Inbox: Chris's newest emails (sender, subject, time; lead/job alerts filtered) from an encrypted per-device feed.
//   Every other bot: its current task from tasks.json (busy) or a clear idle / roaming screen. No made-up activity.
//   Busy + live work feed (HQ #31, tools/work-live.mjs): LIVE view = current step + file, the last output lines scrolling
//   like a terminal, and thumbnails of the newest images (e.g. Atom Family Designer's design PNGs).
//   HQ #46 progress: every busy screen shows a stage track QUEUED → WORKING → REVIEW → DONE (or BLOCKED), a progress bar
//   with % when known, and the step checklist (✓ done, ▶ now, ○ todo). Updates live as the 12 s feed poll lands: the bar
//   eases to the new %, a stage change flashes, no page reload.
//   Family Inbox: a REFRESH button on the screen (HQ #29) asks Grok Bot for a fresh pull.
// Data stays private: the transcript comes from this iPad's own HQ chat log (end-to-end encrypted relay), never a public file.
// Perf (iPad): canvases redraw on change or at most ~3 fps for the cursor/scroll animation, and only for desks within
// ~16 m of you (or the one you're focused on). The 3D loop just calls tick() every frame; it's time-gated inside.
import * as THREE from './vendor/three.module.js';

const FONT = 'system-ui,-apple-system,Segoe UI,Arial';
const HERO_W = 1024, HERO_H = 600, W = 768, H = 450;   // same 512:300 aspect as the monitor planes
const NEAR = 16, FRAME_MS = 330;
const REFRESHABLE = { inbox: 'inbox' }; // station id -> refresh kind (screen gets a REFRESH button)
const WORK_FRESH = 3 * 3600e3;          // live work feed older than this: back to the plain task card
// review / queued / blocked wait on people, so those feeds stay up (even when the bot is roaming) for longer
const STAGE_FRESH = { review: 48 * 3600e3, queued: 48 * 3600e3, blocked: 24 * 3600e3 };
const liveWork = m => m.work && (m.busy || STAGE_FRESH[m.work.stage]) && Date.now() - m.work.at < (STAGE_FRESH[m.work.stage] || WORK_FRESH);
const STAGES = ['queued', 'working', 'review', 'done'];
const STAGE_COL = { queued: '#90a4ae', working: '#ffb74d', review: '#64b5f6', done: '#66bb6a', blocked: '#ef5350' };
const STAGE_LABEL = { queued: 'QUEUED', working: 'WORKING', review: 'REVIEW', done: 'DONE', blocked: 'BLOCKED' };
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

// ---------- HQ #46 progress: stage track + bar + step checklist ----------
// stage track: four pills, past ones dim-filled with ✓, the current one solid + pulsing; BLOCKED replaces the WORKING pill in red
function stageTrack(g, x, y, w, h, stage, t, flash) {
  const blocked = stage === 'blocked', cur = blocked ? 1 : Math.max(0, STAGES.indexOf(stage)), gap = 18, pw = (w - gap * 3) / 4;
  for (let i = 0; i < 4; i++) {
    const px = x + i * (pw + gap), key = i === 1 && blocked ? 'blocked' : STAGES[i], col = STAGE_COL[key], past = i < cur, now = i === cur;
    if (i) { g.fillStyle = past || now ? col : 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(px - gap + 3, y + h / 2 - 6); g.lineTo(px - 3, y + h / 2); g.lineTo(px - gap + 3, y + h / 2 + 6); g.fill(); }
    rr(g, px, y, pw, h, h / 2);
    if (now) { const pulse = 0.75 + 0.25 * Math.sin(t / 260); g.globalAlpha = flash ? 1 : pulse; g.fillStyle = col; g.fill(); g.globalAlpha = 1; if (flash) { g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); } }
    else if (past) { g.fillStyle = col + '44'; g.fill(); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); }
    else { g.fillStyle = 'rgba(255,255,255,.05)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.18)'; g.stroke(); }
    g.fillStyle = now ? '#10141c' : past ? col : 'rgba(255,255,255,.4)'; g.font = `900 ${Math.round(h * 0.5)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((past ? '✓ ' : '') + STAGE_LABEL[key], px + pw / 2, y + h / 2 + 1);
  }
}
// progress bar: eased % (m.pshow) + label; no % known -> an indeterminate stripe sweeping while working
function progressBar(g, x, y, w, h, pct, stage, label, t) {
  const col = STAGE_COL[stage] || STAGE_COL.working;
  rr(g, x, y, w, h, h / 2); g.fillStyle = 'rgba(255,255,255,.08)'; g.fill();
  if (pct != null) { if (pct > 0) { rr(g, x, y, Math.max(h, w * pct / 100), h, h / 2); g.fillStyle = col; g.fill(); } }
  else if (stage === 'working' || stage === 'queued') { g.save(); rr(g, x, y, w, h, h / 2); g.clip(); const sw = w * 0.22, sx = x - sw + ((t / 9) % (w + sw)); g.fillStyle = col + '99'; g.fillRect(sx, y, sw, h); g.restore(); }
  g.textBaseline = 'middle'; g.font = `800 ${Math.round(h * 0.62)}px ${FONT}`;
  const txt = (pct != null ? Math.round(pct) + '%  ' : '') + (label || '');
  // two-tone label: dark over the filled part, white over the empty track
  const lbl = wrapOne(g, txt, w - 24), fx = pct != null ? x + Math.max(h, w * pct / 100) : x; g.textAlign = 'left';
  g.save(); g.beginPath(); g.rect(x, y, fx - x, h); g.clip(); g.fillStyle = '#10141c'; g.fillText(lbl, x + 12, y + h / 2 + 1); g.restore();
  g.save(); g.beginPath(); g.rect(fx, y, x + w - fx, h); g.clip(); g.fillStyle = '#fff'; g.fillText(lbl, x + 12, y + h / 2 + 1); g.restore();
}
const wrapOne = (g, s, maxW) => wrap(g, s, maxW, 1)[0] || '';
// checklist: a window of rows around the current step
function stepList(g, x, y, w, rows, steps, t) {
  const lh = 24, i0 = Math.max(0, Math.min(steps.findIndex(s => s.s === 'now') - 1, steps.length - rows)), shown = steps.slice(Math.max(0, i0), Math.max(0, i0) + rows);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  shown.forEach((st, k) => {
    const yy = y + k * lh + lh / 2, idx = Math.max(0, i0) + k + 1;
    g.font = `800 17px ${FONT}`; g.fillStyle = st.s === 'done' ? STAGE_COL.done : st.s === 'now' ? STAGE_COL.working : 'rgba(255,255,255,.35)';
    g.fillText(st.s === 'done' ? '✓' : st.s === 'now' ? ((t / 500 | 0) % 2 ? '▶' : '▷') : '○', x, yy);
    g.font = `${st.s === 'now' ? 800 : 500} 17px ${FONT}`; g.fillStyle = st.s === 'done' ? 'rgba(255,255,255,.5)' : st.s === 'now' ? '#fff' : 'rgba(255,255,255,.6)';
    g.fillText(wrapOne(g, `${idx}. ${st.t}`, w - 26), x + 24, yy);
  });
  return shown.length * lh;
}

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
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 28px ${FONT}`; g.fillText(s.bot ? `${s.name} · ${s.bot}` : s.name, pad, hh + 16);
  if (m.busy) {
    const stage = m.stage || 'working';
    stageTrack(g, pad, hh + 58, w - pad * 2, 34, stage, t, m.flashUntil > performance.now());
    const dp = m.deskPct;
    if (dp != null) progressBar(g, pad, hh + 102, w - pad * 2, 26, dp, stage, '', t);
    const ty = dp != null ? hh + 140 : hh + 108;
    g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillStyle = '#ffb74d'; g.font = `800 20px ${FONT}`; g.fillText('CURRENT TASK', pad, ty);
    g.fillStyle = '#fff'; g.font = `700 40px ${FONT}`;
    const lines = wrap(g, m.task || 'On a task', w - pad * 2 - 30, dp != null ? 3 : 4);
    lines.forEach((l, k) => g.fillText(l, pad, ty + 28 + k * 48));
    // blinking cursor after the last line
    if ((t / 530 | 0) % 2) { const lw = g.measureText(lines[lines.length - 1]).width; g.fillStyle = '#ffb74d'; g.fillRect(pad + lw + 8, ty + 32 + (lines.length - 1) * 48, 16, 38); }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 22px ${FONT}`; g.textBaseline = 'bottom';
    const bits = [m.since ? `At desk ${ago(m.since)}` : 'At desk'];
    if (m.until) bits.push(`until ${hm(m.until)}`);
    g.fillText(bits.join('  ·  '), pad, h - 22);
  } else {
    g.fillStyle = s.color; g.globalAlpha = 0.22; { let fs = s.short.length > 3 ? 120 : 150; g.font = `900 ${fs}px ${FONT}`; while (g.measureText(s.short).width > w - 40 && fs > 40) { fs -= 6; g.font = `900 ${fs}px ${FONT}`; } } g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.short, w / 2, h / 2 + 30); g.globalAlpha = 1;
    g.fillStyle = '#7CFC9A'; g.font = `800 44px ${FONT}`; g.fillText('Idle · roaming the floor', w / 2, h / 2 + 10);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 27px ${FONT}`; g.fillText('No task right now. Ready when you need it.', w / 2, h / 2 + 66);
  }
  scan(g, w, h);
  if (REFRESHABLE[s.id]) refreshBtn(g, m, t);
}

// ---------- REFRESH button (HQ #29) on refreshable screens: bottom-right, big enough to tap on the 3D monitor ----------
const BTN = { w: 236, h: 50, m: 4 };
const btnRect = () => ({ x: W - BTN.w - BTN.m, y: H - BTN.h - BTN.m, w: BTN.w, h: BTN.h });
function refreshBtn(g, m, t) {
  const r = btnRect(), rs = m.refresh || {}, hot = m.hover;
  const asked = rs.state === 'asked', fresh = rs.state === 'fresh', failed = rs.state === 'failed';
  const bg = failed ? '#b3261e' : fresh ? '#1f8a4c' : asked ? '#1d4fb8' : '#e8a33d';
  rr(g, r.x, r.y, r.w, r.h, 12); g.fillStyle = bg; g.fill();
  if (hot) { g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke(); }
  g.fillStyle = asked || fresh || failed ? '#fff' : '#1a1206'; g.font = `900 25px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const dots = '.'.repeat(1 + (t / 450 | 0) % 3);
  g.fillText(failed ? 'NOT SENT · TAP' : fresh ? 'FRESH ✓' : asked ? 'ASKED GROK' + dots : '⟳ REFRESH', r.x + r.w / 2, r.y + r.h / 2 + 1);
}

// ---------- live work (tools/work-live.mjs): step + file, scrolling output lines, image thumbnails ----------
function drawWork(g, s, m, t) {
  const w = W, h = H, hh = 58, pad = 22, wk = m.work, thumbs = (m.thumbs || []).filter(x => x.img.complete && x.img.naturalWidth);
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, w, h);
  const stage = wk.stage || 'working', steps = wk.steps || [];
  header(g, w, s, stage !== 'done', 'LIVE · ' + s.short, hh);
  // pulsing LIVE dot
  g.fillStyle = (t / 600 | 0) % 2 ? '#ff5252' : '#ff8a80'; g.beginPath(); g.arc(w - 120, hh / 2, 7, 0, 7); g.fill();
  g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillStyle = STAGE_COL[stage] || '#ffb74d'; g.font = `800 17px ${FONT}`; g.fillText(wrapOne(g, (wk.task || m.task || 'ON A TASK').toUpperCase(), w - pad * 2), pad, hh + 8);
  stageTrack(g, pad, hh + 30, w - pad * 2, 30, stage, t, m.flashUntil > performance.now());
  // bar label: the current step ("Step 3/5 · Print check") else the free-text step
  const ni = steps.findIndex(x => x.s === 'now'), stepTxt = ni >= 0 ? `Step ${ni + 1}/${steps.length} · ${steps[ni].t}` : (wk.step || (stage === 'review' ? 'Waiting for review' : 'Working…'));
  progressBar(g, pad, hh + 68, w - pad * 2, 30, m.pshow, stage, stepTxt, t);
  let y = hh + 106;
  if (ni >= 0 && wk.step) { g.fillStyle = '#fff'; g.font = `600 19px ${FONT}`; g.textBaseline = 'top'; g.fillText(wrapOne(g, wk.step, w - pad * 2), pad, y); y += 24; }
  if (wk.file) { g.textBaseline = 'top'; g.fillStyle = '#8fd3ff'; g.font = `600 17px ui-monospace,Menlo,monospace`; g.fillText('▸ ' + wrapOne(g, wk.file, w - pad * 2 - 30), pad, y); y += 24; }
  // thumbnails strip (newest first) on the right
  const tw = thumbs.length ? 224 : 0, tGap = 8, colX = w - pad - tw;
  if (thumbs.length) {
    const rows = Math.max(1, Math.min(2, Math.floor((h - 30 - y) / ((tw - tGap) / 2 + 20))));
    for (let i = 0; i < Math.min(thumbs.length, rows * 2); i++) {
      const th = thumbs[i], cw = (tw - tGap) / 2, ch = cw * 1.0, cx = colX + (i % 2) * (cw + tGap), cy = y + 4 + (i / 2 | 0) * (ch + 20);
      g.fillStyle = '#fff'; g.fillRect(cx - 2, cy - 2, cw + 4, ch + 4);
      const ar = th.img.naturalWidth / th.img.naturalHeight, dw = ar > 1 ? cw : ch * ar, dh = ar > 1 ? cw / ar : ch;
      g.fillStyle = '#e9e6df'; g.fillRect(cx, cy, cw, ch); g.drawImage(th.img, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
      if (i === 0) { g.strokeStyle = '#ffb74d'; g.lineWidth = 3; g.strokeRect(cx - 3, cy - 3, cw + 6, ch + 6); }
      g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `500 12px ${FONT}`; g.textBaseline = 'top';
      g.fillText(wrap(g, th.n.replace(/\.(png|jpe?g|webp)$/i, ''), cw, 1)[0], cx, cy + ch + 4);
    }
  }
  // step checklist (if the bot set steps), then the terminal below it
  const leftW = (thumbs.length ? colX - 14 : w - pad) - pad;
  if (steps.length) y += stepList(g, pad, y + 2, leftW, Math.min(steps.length, 4), steps, t) + 6;
  // terminal: last output lines, newest at the bottom, sliding up as lines arrive
  const tx = pad, tW = leftW, ty = y + 2, tH = Math.max(40, h - 32 - ty);
  rr(g, tx, ty, tW, tH, 8); g.fillStyle = '#05080c'; g.fill(); g.strokeStyle = '#1f2a37'; g.lineWidth = 2; g.stroke();
  g.save(); g.beginPath(); g.rect(tx, ty, tW, tH); g.clip();
  g.font = `500 17px ui-monospace,Menlo,monospace`; g.textBaseline = 'alphabetic';
  const lh = 22, lines = []; for (const l of wk.lines || []) lines.push(...wrap(g, l, tW - 24, 3));
  let ly = ty + tH - 10 + (m.wscroll || 0);
  for (let i = lines.length - 1; i >= 0 && ly > ty; i--, ly -= lh) {
    const newest = i === lines.length - 1; g.fillStyle = newest ? '#b9f6ca' : 'rgba(185,246,202,' + Math.max(0.35, 0.85 - (lines.length - 1 - i) * 0.06) + ')';
    g.fillText(lines[i], tx + 12, ly);
    if (newest && (t / 530 | 0) % 2) { const lw = g.measureText(lines[i]).width; g.fillRect(tx + 16 + lw, ly - 15, 10, 18); }
  }
  g.restore();
  g.textBaseline = 'bottom'; g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 17px ${FONT}`;
  const bits = [`updated ${ago(wk.at)}${ago(wk.at) === 'just now' ? '' : ' ago'}`]; if (wk.stageAt) bits.push(`${STAGE_LABEL[stage] || stage} for ${ago(wk.stageAt)}`); if (m.busy && m.since) bits.push(`at desk ${ago(m.since)}`);
  if (wk.images) bits.push(`${wk.images} image${wk.images === 1 ? '' : 's'}`);
  g.fillText(bits.join('  ·  '), pad, h - 8);
  scan(g, w, h);
}

// ---------- Family Inbox: Chris's real inbox (headers only, lead/job mail filtered; encrypted feed) ----------
function drawInbox(g, s, m, t) {
  const w = W, h = H, hh = 58, pad = 22, foot = 58, f = m.inbox;
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
  g.fillText(`${unread} unread · ${f.leads || 0} leads hidden · updated ${ago(f.at)}${ago(f.at) === 'just now' ? '' : ' ago'}`, pad, h - foot / 2);
  scan(g, w, h);
  refreshBtn(g, m, t);
}

function setPct(m, p) {
  if (p == null || !Number.isFinite(p)) { m.ptarget = m.pshow = null; return; }
  m.ptarget = Math.max(0, Math.min(100, p)); if (m.pshow == null) m.pshow = m.ptarget; m.dirty = true;
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
  function draw(m, t) {
    const fn = m.s.hero ? drawHero : m.inbox && Date.now() - m.inbox.at < INBOX_STALE ? drawInbox : liveWork(m) ? drawWork : drawDesk;
    fn(m.g, m.s, m, t); m.tex.needsUpdate = true; m.last = t; m.dirty = false;
  }
  function animated(m, d, focused) {
    if (m.scroll > 0.5) return true;
    if (m.wscroll > 0.5) return true;
    if (m.ptarget != null && m.pshow !== m.ptarget) return true;      // HQ #46 progress bar easing
    if (m.flashUntil > performance.now() + 0) return true;              // stage just changed
    if (liveWork(m) && (d < 7 || focused)) return true;                 // stage pulse / indeterminate bar
    if (m.s.hero) return d < 10 || focused; // status dots / cursor
    if (m.refresh?.state === 'asked' && (d < 7 || focused)) return true; // "ASKED GROK..." dots
    return m.busy && (d < 7 || focused);    // blinking cursor while working, only up close
  }
  let lastMinute = -1, nextAt = 0;
  return {
    canvas: id => mons.get(id)?.c,
    setStatus(id, busy, task, since, until, extra = {}) {
      const m = mons.get(id); if (!m) return;
      const st = busy ? extra.stage || 'working' : '';
      if (st && m.stage && st !== m.stage && !liveWork(m)) m.flashUntil = performance.now() + 2500;
      m.stage = st; m.deskPct = busy && extra.pct != null && Number.isFinite(+extra.pct) ? Math.max(0, Math.min(100, +extra.pct)) : null;
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
    // live work feed (hq-link.fetchWorkFeed): { bots: { id: { step, file, lines[], thumbs:[{n,d}], images, at } } }
    setWork(feed) {
      const bots = (feed && feed.bots) || {};
      for (const m of mons.values()) {
        if (m.s.hero) continue;
        const wk = bots[m.s.id] || null, sig = wk ? JSON.stringify([wk.at, wk.step, wk.file, wk.lines, wk.stage, wk.pct, wk.steps, wk.task, (wk.thumbs || []).map(x => x.n)]) : '';
        if (sig === m.wsig) continue;
        if (wk && m.work && wk.stage !== m.work.stage) m.flashUntil = performance.now() + 2500;   // stage changed: flash the pill
        setPct(m, wk ? (wk.pct != null ? wk.pct : wk.steps?.length ? 100 * wk.steps.filter(x => x.s === 'done').length / wk.steps.length : null) : null);
        const grew = wk && m.work && (wk.lines || []).length && JSON.stringify(wk.lines) !== JSON.stringify(m.work.lines);
        m.wsig = sig; m.work = wk; m.dirty = true; if (grew) m.wscroll = 44;
        const names = (wk?.thumbs || []).map(x => x.n).join('|');
        if (names !== m.tsig) {
          m.tsig = names;
          m.thumbs = (wk?.thumbs || []).map(x => { const img = new Image(); img.onload = () => { m.dirty = true; }; img.src = x.d; return { n: x.n, img }; });
        }
      }
    },
    // HQ #29 REFRESH button: uv on a monitor plane -> refresh kind when it's on the button
    hitTest(id, uv) {
      const m = mons.get(id); if (!m || !REFRESHABLE[id] || !uv || m.s.hero) return null;
      const px = uv.x * W, py = (1 - uv.y) * H, r = btnRect(), k = 12;
      return px > r.x - k && px < r.x + r.w + k && py > r.y - k && py < r.y + r.h + k ? REFRESHABLE[id] : null;
    },
    setHover(id, h) { for (const m of mons.values()) { const v = m.s.id === id && !!h; if (!!m.hover !== v) { m.hover = v; m.dirty = true; } } },
    setRefresh(id, r) { const m = mons.get(id); if (!m) return; const sig = JSON.stringify(r || null); if (sig !== m.rsig) { m.rsig = sig; m.refresh = r; m.dirty = true; } },
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
        if (m.wscroll > 0.5) m.wscroll *= 0.5; else m.wscroll = 0;
        if (m.ptarget != null && m.pshow !== m.ptarget) { m.pshow += (m.ptarget - m.pshow) * 0.35; if (Math.abs(m.ptarget - m.pshow) < 0.6) m.pshow = m.ptarget; }
        if (m.dirty || animated(m, d, focused)) draw(m, now);
      }
    },
  };
}
