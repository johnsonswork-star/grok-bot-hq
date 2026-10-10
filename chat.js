// HQ chat panel: UI only. Delivery lives in hq-link.js so it can be swapped later.
import * as link from './hq-link.js';

const LOG = 'hq.chatLog';
const CHIPS = ['Status update?', "What's next today?", 'Anything need me?', 'Good work, team'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createChat({ stations, onOpenChange }) {
  const el = document.getElementById('chat');
  const $ = s => el.querySelector(s);
  const log = $('.log'), input = $('input'), sel = $('select'), chipsEl = $('.chips'), status = $('.cstatus');
  sel.innerHTML = stations.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  chipsEl.innerHTML = CHIPS.map((c, i) => `<button type="button" data-i="${i}">${esc(c)}</button>`).join('');
  let open = false, chipIdx = -1, target = stations.find(s => s.hero) || stations[0], pollT = null;
  let entries = []; try { entries = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) {}
  const save = () => { try { localStorage.setItem(LOG, JSON.stringify(entries.slice(-80))); } catch (e) {} };

  function render() {
    log.innerHTML = entries.length ? entries.map(m => {
      if (m.kind === 'me') return `<div class="msg me"><div class="who">You → ${esc(m.to)}</div><div class="txt">${esc(m.text)}</div>
        <div class="st ${m.status}">${m.status === 'delivered' ? '✓ Delivered to Grok Bot &amp; team'
          : m.status === 'sending' ? 'Sending…'
          : `<a href="${esc(m.url)}" target="_blank" rel="noopener">${m.status === 'failed' ? '⚠ Not sent. Tap to send via GitHub' : 'Tap here, then Submit, to deliver'}</a>`}</div></div>`;
      return `<div class="msg bot"><div class="who">${esc(m.from)}</div><div class="txt">${esc(m.text)}</div></div>`;
    }).join('') : `<div class="empty">Messages go straight to Grok Bot and the team. Replies show up here.</div>`;
    log.scrollTop = log.scrollHeight;
    status.innerHTML = link.isLinked() ? '<span class="ok">● Linked to Grok Bot + team</span>'
      : '<span class="warn">● HQ link not set up on this device. Sends open GitHub to submit</span>';
  }
  function setTarget(s) { target = s || target; sel.value = target.id; $('.cname').textContent = target.name; $('.cdot').style.background = target.color; input.placeholder = `Message ${target.name}${target.hero ? '' : ' (via Grok Bot)'}…`; }
  sel.addEventListener('change', () => setTarget(stations.find(s => s.id === sel.value)));

  async function send(text) {
    text = (text || '').trim(); if (!text) return;
    const m = { kind: 'me', to: target.name, text, at: Date.now(), status: 'sending' };
    entries.push(m); render();
    const r = await link.send({ to: target.name, text, sentAt: new Date() });
    Object.assign(m, { status: r.status, url: r.url || '', ref: r.ref }); save(); render();
    // A pre-filled GitHub page only opens from a real tap (iOS blocks pop-ups from controller presses).
    if (r.status === 'needs-tap' && lastGesture && Date.now() - lastGesture < 900) window.open(r.url, '_blank', 'noopener');
  }
  let lastGesture = 0;
  el.addEventListener('pointerdown', () => { lastGesture = Date.now(); }, true);
  $('form').addEventListener('submit', e => { e.preventDefault(); lastGesture = Date.now(); const t = input.value; input.value = ''; send(t); });
  chipsEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { lastGesture = Date.now(); send(CHIPS[+b.dataset.i]); } });
  $('.cx').addEventListener('click', () => close());

  async function poll() {
    const replies = await link.fetchReplies();
    let added = false;
    for (const r of replies) if (!entries.some(e => e.kind === 'bot' && e.id === r.id)) { entries.push({ kind: 'bot', ...r }); added = true; }
    if (added) { entries.sort((a, b) => (new Date(a.at)) - (new Date(b.at))); save(); render(); }
  }
  function show(s) {
    if (open) return; open = true; setTarget(s); chipIdx = -1; markChip();
    el.classList.add('open'); document.documentElement.classList.add('chatting'); render();
    poll(); pollT = setInterval(poll, 15000);
    onOpenChange?.(true);
  }
  function close() {
    if (!open) return; open = false; input.blur();
    el.classList.remove('open'); document.documentElement.classList.remove('chatting');
    clearInterval(pollT); onOpenChange?.(false);
  }
  function markChip() { [...chipsEl.children].forEach((b, i) => b.classList.toggle('sel', i === chipIdx)); }
  // controller while chat is open: LB/RB pick bot, D-pad picks a quick message, A sends it, R stick scrolls, B closes
  function pad(gp) {
    if (!open || !gp) return;
    if (gp.B) return close();
    if (gp.LB || gp.RB) { const i = stations.indexOf(target); setTarget(stations[(i + (gp.RB ? 1 : -1) + stations.length) % stations.length]); }
    if (gp.dpad.right || gp.dpad.down) { chipIdx = (chipIdx + 1) % CHIPS.length; markChip(); }
    if (gp.dpad.left || gp.dpad.up) { chipIdx = (chipIdx - 1 + CHIPS.length) % CHIPS.length; markChip(); }
    if (gp.A) { if (chipIdx >= 0) send(CHIPS[chipIdx]); else if (input.value.trim()) { const t = input.value; input.value = ''; send(t); } else input.focus(); }
    if (gp.R[1]) log.scrollTop += gp.R[1] * 14;
  }
  render();
  return { show, close, toggle: s => (open ? close() : show(s)), isOpen: () => open, pad, isTyping: () => document.activeElement === input };
}
