// HQ chat panel: UI only. Delivery lives in hq-link.js so it can be swapped later.
import * as link from './hq-link.js';

const LOG = 'hq.chatLog';
const CHIPS = ['Status update?', "What's next today?", 'Anything need me?', 'Good work, team'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createChat({ stations, onOpenChange, snapshot, onLog }) {
  const el = document.getElementById('chat');
  const $ = s => el.querySelector(s);
  const log = $('.log'), input = $('input'), sel = $('select'), chipsEl = $('.chips'), status = $('.cstatus');
  sel.innerHTML = stations.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  chipsEl.innerHTML = CHIPS.map((c, i) => `<button type="button" data-i="${i}">${esc(c)}</button>`).join('');
  let open = false, chipIdx = -1, target = stations.find(s => s.hero) || stations[0], pollT = null;
  let entries = []; try { entries = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) {}
  const save = () => { try { localStorage.setItem(LOG, JSON.stringify(entries.slice(-80))); } catch (e) {} };

  // m.shot: 'on' = view screenshot rode along, 'off' = capture failed/too big (text still sent)
  const shotNote = m => m.shot === 'on' ? ' · 📸 view attached' : m.shot === 'off' ? ' · <span class="noshot">no view shot</span>' : '';
  function render() {
    log.innerHTML = entries.length ? entries.map(m => {
      if (m.kind === 'me') return `<div class="msg me"><div class="who">You → ${esc(m.to)}</div><div class="txt">${esc(m.text)}</div>
        <div class="st ${m.status}">${m.status === 'delivered' ? '✓ Delivered to Grok Bot &amp; team' + (m.issue ? ` · #${m.issue}` : '') + shotNote(m)
          : m.status === 'sending' ? 'Sending…' + (m.shot === 'on' ? ' 📸' : '')
          : `<a href="#" class="retry" data-at="${m.at}">⚠ Not sent (no signal?). Tap to retry</a>`}</div></div>`;
      return `<div class="msg bot"><div class="who">${esc(m.from)}</div><div class="txt">${esc(m.text)}</div></div>`;
    }).join('') : `<div class="empty">Messages go straight to Grok Bot and the team. Replies show up here.</div>`;
    log.scrollTop = log.scrollHeight;
    try { onLog?.(entries); } catch (e) {} // Grok Bot's desk monitor mirrors this log live
    status.innerHTML = link.isLinked() ? '<span class="ok">● Live to Grok Bot + team (encrypted)</span>'
      : '<span class="warn">● This browser can\'t encrypt messages. Update iPadOS / Safari</span>';
  }
  function setTarget(s) { target = s || target; sel.value = target.id; $('.cname').textContent = target.name; $('.cdot').style.background = target.color; input.placeholder = `Message ${target.name}${target.hero ? '' : ' (via Grok Bot)'}…`; }
  sel.addEventListener('change', () => setTarget(stations.find(s => s.id === sel.value)));

  // Typed messages carry a shot of the 3D view (could be a "change this" ask); canned quick chips don't need one.
  async function send(text, noShot = CHIPS.includes(String(text || '').trim())) {
    text = (text || '').trim(); if (!text) return;
    const m = { kind: 'me', to: target.name, text, at: Date.now(), status: 'sending', noShot };
    entries.push(m); render();
    await deliver(m);
  }
  async function deliver(m) {
    // Screenshot of the 3D view rides along so Grok Bot can see what Chris sees. Never blocks the text.
    let shot = null; if (!m.noShot) try { shot = snapshot?.() || null; } catch (e) {}
    m.status = 'sending'; m.shot = m.noShot ? '' : shot ? 'on' : 'off'; render();
    const r = await link.send({ to: m.to, text: m.text, sentAt: new Date(m.at), shot });
    Object.assign(m, { status: r.status, ref: r.ref, shot: m.noShot ? '' : r.shot ? 'on' : 'off' }); save(); render();
  }
  log.addEventListener('click', e => {
    const a = e.target.closest('a.retry'); if (!a) return; e.preventDefault();
    const m = entries.find(x => x.kind === 'me' && String(x.at) === a.dataset.at); if (m) deliver(m);
  });
  $('form').addEventListener('submit', e => { e.preventDefault(); const t = input.value; input.value = ''; send(t); });
  chipsEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { send(CHIPS[+b.dataset.i]); } });
  $('.cx').addEventListener('click', () => close());

  async function poll() {
    const replies = await link.fetchReplies();
    let added = false;
    for (const r of replies) {
      if (r.type === 'ack') { const m = entries.find(e => e.kind === 'me' && e.ref === r.mid); if (m && m.issue !== r.issue) { m.issue = r.issue; added = true; } continue; }
      if (!entries.some(e => e.kind === 'bot' && e.id === r.id)) { entries.push({ kind: 'bot', ...r }); added = true; }
    }
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
  // background poll (cheap ntfy read, only while the app is visible) so replies reach the desk monitor without opening chat
  poll(); setInterval(() => { if (!open && !document.hidden) poll(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  return { show, close, toggle: s => (open ? close() : show(s)), isOpen: () => open, pad, isTyping: () => document.activeElement === input,
    // live reload: never reload mid-send; carry the draft + who you were talking to across the reload
    isSending: () => entries.some(m => m.kind === 'me' && m.status === 'sending'),
    draft: () => ({ text: input.value, to: target.id }),
    restoreDraft(d) { if (!d) return; const s = stations.find(x => x.id === d.to); if (s) setTarget(s); if (d.text) input.value = d.text; } };
}
