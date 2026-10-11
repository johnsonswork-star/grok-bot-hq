// HQ chat panel = ONE office chat (HQ #59). UI only; delivery lives in hq-link.js.
// One chronological stream: Chris's messages (from any device), the cheap office bot's in-character replies, the real Grok Bot's
// replies (Michael), and teammates' own lines + banter. Default audience is the whole office; LB/RB or the dropdown can still
// point a message at one person. Each send is triaged by office-chat-rules.js (same rules the box uses):
//   office route = small talk + safe in-game commands -> commands run here instantly, the office bot answers (free);
//   grok route   = real orders -> filed for the real Grok Bot (HQ issue + Slack wake), with the 3D view screenshot.
import * as link from './hq-link.js';
import { triage, cmdLine, OFFICE_TO, idOf } from './office-chat-rules.js';

const LOG = 'hq.chatLog', FEED = 'hq.officeFeed';
const CHIPS = ['Status update?', "What's next today?", 'Anything need me?', 'Good work, team', 'Everyone back to your desks', 'Tell me a joke'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tms = x => typeof x === 'number' ? x : Date.parse(x) || +x || 0;
const hm = t => { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };

export function createChat({ stations, onOpenChange, snapshot, onLog, near, onCommands }) {
  const el = document.getElementById('chat');
  const $ = s => el.querySelector(s);
  const log = $('.log'), input = $('input'), sel = $('select'), chipsEl = $('.chips'), status = $('.cstatus');
  const OFFICE = { id: 'office', name: 'Whole office', bot: '', color: '#e8a33d', office: true };
  const targets = [OFFICE, ...stations];
  const stOf = id => stations.find(s => s.id === id);
  sel.innerHTML = targets.map(s => `<option value="${s.id}">${s.office ? '📣 Whole office' : esc(s.name) + (s.bot ? ' · ' + esc(s.bot) : '')}</option>`).join('');
  chipsEl.innerHTML = CHIPS.map((c, i) => `<button type="button" data-i="${i}">${esc(c)}</button>`).join('');
  try { $('.ctitle').textContent = 'Office chat · everyone'; } catch (e) {}
  let open = false, chipIdx = -1, target = OFFICE, pollT = null, fastUntil = 0;
  let entries = []; try { entries = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) {}
  let office = []; try { office = JSON.parse(localStorage.getItem(FEED) || '[]'); } catch (e) {}
  const save = () => { try { localStorage.setItem(LOG, JSON.stringify(entries.slice(-120))); } catch (e) {} };

  // one stream: this device's own log (sends + statuses + replies) + the shared office feed, de-duplicated
  function merged() {
    const mine = new Set(entries.filter(e => e.kind === 'me' && (e.ref || e.mid)).map(e => e.ref || e.mid)), ids = new Set(entries.filter(e => e.kind === 'bot').map(e => String(e.id)));
    const out = entries.map(e => ({ ...e, t: tms(e.at) }));
    for (const o of office) {
      if (o.kind === 'chris') { if (o.mid && mine.has(o.mid)) continue; out.push({ kind: 'me', text: o.text, to: o.to === OFFICE_TO ? 'the office' : o.to, at: o.at, t: o.at, route: o.route, issue: o.issue, status: 'delivered', other: true }); continue; }
      if (ids.has(String(o.id))) continue;
      out.push({ kind: 'bot', id: o.id, from: o.name, who: o.who, bot: o.bot, text: o.text, at: o.at, t: o.at, sub: o.kind, route: o.route, via: o.via, issue: o.issue });
    }
    return out.sort((a, b) => a.t - b.t).slice(-150);
  }
  const routeNote = m => m.route === 'office' ? ' · 🆓 office bot' : m.route === 'grok' ? ' · ★ to Michael (Grok Bot)' : '';
  const shotNote = m => m.shot === 'on' ? ' · 📸 view attached' : m.shot === 'off' ? ' · <span class="noshot">no view shot</span>' : '';
  function whoLine(m) {
    const id = m.who && m.who !== 'chris' ? m.who : idOf(m.from), s = stOf(id);
    const dot = `<span class="wdot" style="background:${s?.color || '#e8a33d'}"></span>`;
    const name = s ? `${esc(s.name)} · ${esc(s.bot)}` : esc(m.from || 'Grok Bot');
    const tag = m.sub === 'banter' ? ' · <i>chatting</i>' : m.sub === 'say' ? ' · <i>says</i>' : m.route === 'office' || m.office ? ' · 🆓 office bot' : (s?.hero || /grok/i.test(m.from || '')) ? ' · ★ real Grok Bot' : '';
    return `${dot}${name}${tag}<span class="tm">${hm(m.t || tms(m.at))}</span>`;
  }
  let last = '';
  function render() {
    const all = merged();
    const sig = JSON.stringify(all.map(m => [m.kind, m.id || m.at, m.status, m.issue, m.route, m.shot])); if (sig === last && log.childElementCount) return; last = sig;
    log.innerHTML = all.length ? all.map(m => {
      if (m.kind === 'me') return `<div class="msg me"><div class="who">${m.other ? 'You (other device)' : 'You'} → ${esc(m.to === OFFICE_TO ? 'the office' : m.to || 'the office')}<span class="tm">${hm(m.t)}</span></div><div class="txt">${esc(m.text)}</div>
        <div class="st ${m.status}">${m.status === 'delivered' ? '✓ ' + (m.route === 'office' ? 'Office bot has it (free)' : m.route === 'grok' ? 'Sent to Michael (Grok Bot)' : 'Delivered') + (m.issue ? ` · #${m.issue}` : '') + shotNote(m)
          : m.status === 'sending' ? 'Sending…' + (m.shot === 'on' ? ' 📸' : '') + routeNote(m)
          : `<a href="#" class="retry" data-at="${m.at}">⚠ Not sent (no signal?). Tap to retry</a>`}</div></div>`;
      const cls = m.sub === 'banter' || m.sub === 'say' ? 'bot side' : m.sub === 'route' ? 'bot route' : 'bot';
      return `<div class="msg ${cls}"><div class="who">${whoLine(m)}</div><div class="txt">${esc(m.text)}</div></div>`;
    }).join('') : `<div class="empty">The whole office in one chat. Small talk and simple moves ("Phyllis, get out of the way") get answered right here for free. Real orders go to Michael (the real Grok Bot).</div>`;
    log.scrollTop = log.scrollHeight;
    try { onLog?.(entries, all); } catch (e) {} // Grok Bot's desk monitor mirrors the whole office chat; bubbles react to this device's log
    status.innerHTML = link.isLinked() ? '<span class="ok">● One office chat · small talk + moves = free office bot · real orders = Michael (Grok Bot)</span>'
      : '<span class="warn">● This browser can\'t encrypt messages. Update iPadOS / Safari</span>';
  }
  function setTarget(s) {
    target = s || target; sel.value = target.id;
    $('.cname').textContent = target.office ? 'Dunder Mifflin · whole office' : target.bot ? `${target.name} · ${target.bot}` : target.name;
    $('.cdot').style.background = target.color;
    input.placeholder = target.office ? 'Message the office… ("Phyllis, move" works)' : `Message ${target.name}${target.hero ? ' (real Grok Bot)' : ''}…`;
  }
  sel.addEventListener('change', () => setTarget(targets.find(s => s.id === sel.value)));

  async function send(text) {
    text = (text || '').trim(); if (!text) return;
    const to = target.office ? OFFICE_TO : target.bot || target.name;
    let nearId = null; try { nearId = near?.() || null; } catch (e) {}
    const tri = triage(text, { to, near: nearId });
    // safe in-game commands run right now, whatever the route (the rest of an order still goes to Grok Bot)
    if (tri.cmds.length) try { onCommands?.(tri.cmds, text); } catch (e) {}
    const m = { kind: 'me', to, text, at: Date.now(), mid: Math.random().toString(36).slice(2, 11), status: 'sending', route: tri.route, why: tri.why, noShot: tri.route === 'office' || CHIPS.includes(text) };
    entries.push(m);
    let local = null, line = '';
    if (tri.route === 'office' && tri.kind === 'cmd') { // instant in-character answer from the first person you told
      const c = tri.cmds[0], s = stOf(c.bot); line = cmdLine(c.bot, c.act, m.at);
      local = { kind: 'bot', id: 'oc-' + m.mid, from: s?.name || 'Pam Beesly', who: c.bot, text: line, at: new Date(m.at + 400).toISOString(), office: true, route: 'office' };
      entries.push(local);
    }
    render();
    m.office = { near: nearId, bot: tri.cmds[0]?.bot || null, line };
    await deliver(m);
    if (tri.route === 'office') { fastUntil = Date.now() + 30000; fastPoll(); }
  }
  async function deliver(m) {
    let shot = null; if (!m.noShot) try { shot = snapshot?.() || null; } catch (e) {}
    m.status = 'sending'; m.shot = m.noShot ? '' : shot ? 'on' : 'off'; render();
    const r = await link.send({ to: m.to, text: m.text, sentAt: new Date(m.at), shot, office: m.office, mid: m.mid });
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
      if (r.type === 'ack') { const m = entries.find(e => e.kind === 'me' && e.ref === r.mid); if (m && (m.issue !== r.issue || (r.route && m.route !== r.route))) { m.issue = r.issue; if (r.route) m.route = r.route; else if (r.issue) m.route = 'grok'; added = true; } continue; }
      if (!entries.some(e => e.kind === 'bot' && e.id === r.id)) { entries.push({ kind: 'bot', ...r }); added = true; }
    }
    if (added) { entries.sort((a, b) => tms(a.at) - tms(b.at)); save(); render(); }
  }
  function fastPoll() { if (Date.now() > fastUntil) return; setTimeout(() => { poll(); fastPoll(); }, 2500); }
  // shared office feed (main.js polls fetchChatFeed and hands it here)
  function setFeed(items) {
    if (!Array.isArray(items)) return; office = items.slice(-150);
    try { localStorage.setItem(FEED, JSON.stringify(office)); } catch (e) {}
    render();
  }
  function show() {
    if (open) return; open = true; setTarget(target.office ? OFFICE : target); chipIdx = -1; markChip();
    el.classList.add('open'); document.documentElement.classList.add('chatting'); last = ''; render();
    poll(); pollT = setInterval(poll, 8000);
    onOpenChange?.(true);
  }
  function close() {
    if (!open) return; open = false; input.blur();
    el.classList.remove('open'); document.documentElement.classList.remove('chatting');
    clearInterval(pollT); onOpenChange?.(false);
  }
  function markChip() { [...chipsEl.children].forEach((b, i) => b.classList.toggle('sel', i === chipIdx)); }
  // controller while chat is open: LB/RB pick who (Whole office first), D-pad picks a quick message, A sends it, R stick scrolls, B closes
  function pad(gp) {
    if (!open || !gp) return;
    if (gp.B) return close();
    if (gp.LB || gp.RB) { const i = targets.indexOf(target); setTarget(targets[(i + (gp.RB ? 1 : -1) + targets.length) % targets.length]); }
    if (gp.dpad.right || gp.dpad.down) { chipIdx = (chipIdx + 1) % CHIPS.length; markChip(); }
    if (gp.dpad.left || gp.dpad.up) { chipIdx = (chipIdx - 1 + CHIPS.length) % CHIPS.length; markChip(); }
    if (gp.A) { if (chipIdx >= 0) send(CHIPS[chipIdx]); else if (input.value.trim()) { const t = input.value; input.value = ''; send(t); } else input.focus(); }
    if (gp.R[1]) log.scrollTop += gp.R[1] * 14;
  }
  render();
  poll(); setInterval(() => { if (!open && !document.hidden) poll(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  return { show, close, toggle: s => (open ? close() : show(s)), isOpen: () => open, pad, isTyping: () => document.activeElement === input, setFeed,
    isSending: () => entries.some(m => m.kind === 'me' && m.status === 'sending'),
    draft: () => ({ text: input.value, to: target.id }),
    restoreDraft(d) { if (!d) return; const s = targets.find(x => x.id === d.to); if (s) setTarget(s); if (d.text) input.value = d.text; } };
}
