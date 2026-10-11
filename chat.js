// HQ chat panel = ONE office chat (HQ #59). UI only; delivery lives in hq-link.js.
// One chronological stream: Chris's messages (from any device), the cheap office bot's in-character replies, the real Grok Bot's
// replies (Michael), and teammates' own lines + banter. Default audience is the whole office; LB/RB or the dropdown can still
// point a message at one person. Each send is triaged by office-chat-rules.js (same rules the box uses):
//   office route = small talk + safe in-game commands -> commands run here instantly, the office bot answers (free);
//   grok route   = real orders -> filed for the real Grok Bot (HQ issue + Slack wake), with the 3D view screenshot.
import * as link from './hq-link.js';
import { triage, cmdLine, OFFICE_TO, idOf } from './office-chat-rules.js';
// HQ #63: three tabs. ★ Michael = the real Grok Bot only. 📣 Office = the #59 whole-office stream. 💬 Direct = pick ONE teammate and
// talk 1:1 WITHOUT Michael: sends carry `direct: { bot }`, the box (tools/direct.mjs) answers as that person (office stand-in, free)
// and, when a real teammate agent sits behind the desk (stations.js `teammate: true`), queues it for them; their own answer
// comes back into the same thread labeled "✓ real <teammate>". Direct threads never show in the Office / Michael tabs.

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
  // ---- HQ #63 tabs + Direct people picker ----
  const MICHAEL = stations.find(s => s.hero) || stations[0], PEOPLE = stations.filter(s => !s.hero);
  const first = s => (s?.name || '').split(' ')[0];
  let tab = 'office'; try { tab = localStorage.getItem('hq.chatTab') || 'office'; } catch (e) {}
  if (!['office', 'michael', 'direct'].includes(tab)) tab = 'office';
  let dm = null; try { dm = stOf(localStorage.getItem('hq.dmWho')); } catch (e) {} if (!dm || dm.hero) dm = stOf('icons') || PEOPLE[0];
  let seen = {}; try { seen = JSON.parse(localStorage.getItem('hq.dmSeen') || '{}'); } catch (e) {}
  const tabsEl = document.createElement('div'); tabsEl.className = 'ctabs';
  tabsEl.innerHTML = `<button type="button" data-tab="michael">★ Michael <small>(Grok Bot)</small></button><button type="button" data-tab="office">📣 Office</button><button type="button" data-tab="direct">💬 Direct <small>1:1, no Michael</small></button>`;
  const peopleEl = document.createElement('div'); peopleEl.className = 'people';
  peopleEl.innerHTML = PEOPLE.map(s => `<button type="button" data-id="${s.id}" title="${esc(s.name)} · ${esc(s.bot)}"><span class="wdot" style="background:${s.color}"></span>${esc(first(s))}${s.teammate ? ' <b class="real">✓</b>' : ''}<i class="unread"></i></button>`).join('');
  $('.chead').after(tabsEl); tabsEl.after(peopleEl);
  tabsEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  peopleEl.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setDm(stOf(b.dataset.id)); input.focus(); } });
  const threadOf = m => m.thread || '';
  const isMichael = m => !m.thread && (m.kind === 'me' ? (m.to === MICHAEL.bot || m.route === 'grok') : (m.who === MICHAEL.id || m.route === 'grok' || m.sub === 'route' || /grok bot|michael/i.test(m.from || '')));
  function inTab(m) { return tab === 'direct' ? threadOf(m) === 'dm:' + dm.id : tab === 'michael' ? isMichael(m) : !threadOf(m); }
  function setTab(t) {
    tab = t; try { localStorage.setItem('hq.chatTab', t); } catch (e) {}
    el.dataset.tab = t; [...tabsEl.children].forEach(b => b.classList.toggle('sel', b.dataset.tab === t));
    if (t === 'michael') setTarget(MICHAEL); else if (t === 'office') setTarget(target.hero || target.id === dm?.id ? OFFICE : target); else setDm(dm);
    last = ''; render();
  }
  function setDm(s) {
    if (!s || s.hero) return; dm = s; try { localStorage.setItem('hq.dmWho', s.id); } catch (e) {}
    [...peopleEl.children].forEach(b => b.classList.toggle('sel', b.dataset.id === s.id));
    if (tab !== 'direct') return;
    $('.ctitle').textContent = 'Direct · 1:1 · Michael is not in this chat';
    $('.cname').textContent = `${s.name} · ${s.bot}`; $('.cdot').style.background = s.color;
    input.placeholder = s.teammate ? `Message ${first(s)} (goes to the real ${s.bot})…` : `Message ${first(s)} (office character)…`;
    last = ''; render();
  }
  let entries = []; try { entries = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch (e) {}
  let office = []; try { office = JSON.parse(localStorage.getItem(FEED) || '[]'); } catch (e) {}
  const save = () => { try { localStorage.setItem(LOG, JSON.stringify(entries.slice(-120))); } catch (e) {} };

  // one stream: this device's own log (sends + statuses + replies) + the shared office feed, de-duplicated
  function merged() {
    const mine = new Set(entries.filter(e => e.kind === 'me' && (e.ref || e.mid)).map(e => e.ref || e.mid)), ids = new Set(entries.filter(e => e.kind === 'bot').map(e => String(e.id)));
    const out = entries.map(e => ({ ...e, t: tms(e.at) }));
    for (const o of office) {
      if (o.kind === 'chris') { if (o.mid && mine.has(o.mid)) continue; out.push({ kind: 'me', text: o.text, to: o.to === OFFICE_TO ? 'the office' : o.to, at: o.at, t: o.at, route: o.route, issue: o.issue, status: 'delivered', other: true, thread: o.thread }); continue; }
      if (ids.has(String(o.id))) continue;
      out.push({ kind: 'bot', id: o.id, from: o.name, who: o.who, bot: o.bot, text: o.text, at: o.at, t: o.at, sub: o.kind, route: o.route, via: o.via, issue: o.issue, thread: o.thread, real: o.real, standin: o.standin, handoff: o.handoff, teammate: o.teammate });
    }
    return out.sort((a, b) => a.t - b.t).slice(-150);
  }
  const routeNote = m => m.route === 'office' ? ' · 🆓 office bot' : m.route === 'grok' ? ' · ★ to Michael (Grok Bot)' : '';
  const shotNote = m => m.shot === 'on' ? ' · 📸 view attached' : m.shot === 'off' ? ' · <span class="noshot">no view shot</span>' : '';
  function whoLine(m) {
    const id = m.who && m.who !== 'chris' ? m.who : idOf(m.from), s = stOf(id);
    const dot = `<span class="wdot" style="background:${s?.color || '#e8a33d'}"></span>`;
    const name = s ? `${esc(s.name)} · ${esc(s.bot)}` : esc(m.from || 'Grok Bot');
    if (m.thread) return `${dot}${s ? esc(s.name) : esc(m.from || '')}${m.real ? ` · <b class="realtag">✓ real ${esc(m.teammate || s?.bot || '')}</b>` : ' · <span class="standin">🎭 office stand-in</span>'}${m.handoff ? ` · sent to the real ${esc(m.handoff)}` : ''}<span class="tm">${hm(m.t || tms(m.at))}</span>`;
    const tag = m.sub === 'banter' ? ' · <i>chatting</i>' : m.sub === 'say' ? ' · <i>says</i>' : m.route === 'office' || m.office ? ' · 🆓 office bot' : (s?.hero || /grok/i.test(m.from || '')) ? ' · ★ real Grok Bot' : '';
    return `${dot}${name}${tag}<span class="tm">${hm(m.t || tms(m.at))}</span>`;
  }
  function directNote(m) {
    const s = stOf(idOf(m.thread.slice(3))) || stOf(m.thread.slice(3));
    return `Delivered to ${esc(first(s) || m.to)} · no Michael` + (s?.teammate && m.route !== 'office-cmd' ? ` · queued for the real ${esc(s.bot)}` : '');
  }
  function markUnread(every) {
    const lastBy = {};
    for (const m of every) if (m.thread && m.kind === 'bot') lastBy[m.thread] = Math.max(lastBy[m.thread] || 0, m.t || 0);
    if (open && tab === 'direct' && dm) { const k = 'dm:' + dm.id; if ((lastBy[k] || 0) > (seen[k] || 0)) { seen[k] = lastBy[k]; try { localStorage.setItem('hq.dmSeen', JSON.stringify(seen)); } catch (e) {} } }
    [...peopleEl.children].forEach(b => b.classList.toggle('new', (lastBy['dm:' + b.dataset.id] || 0) > (seen['dm:' + b.dataset.id] || 0)));
    const any = Object.keys(lastBy).some(k => lastBy[k] > (seen[k] || 0));
    tabsEl.querySelector('[data-tab=direct]').classList.toggle('new', any && tab !== 'direct');
  }
  let last = '';
  function render() {
    const every = merged(), all = every.filter(inTab);
    markUnread(every);
    const sig = tab + (dm?.id || '') + JSON.stringify(all.map(m => [m.kind, m.id || m.at, m.status, m.issue, m.route, m.shot])); if (sig === last && log.childElementCount) return; last = sig;
    log.innerHTML = all.length ? all.map(m => {
      if (m.kind === 'me') return `<div class="msg me"><div class="who">${m.other ? 'You (other device)' : 'You'} → ${esc(m.to === OFFICE_TO ? 'the office' : m.to || 'the office')}<span class="tm">${hm(m.t)}</span></div><div class="txt">${esc(m.text)}</div>
        <div class="st ${m.status}">${m.status === 'delivered' && m.thread ? '✓ ' + directNote(m)
          : m.status === 'delivered' ? '✓ ' + (m.route === 'office' ? 'Office bot has it (free)' : m.route === 'grok' ? 'Sent to Michael (Grok Bot)' : 'Delivered') + (m.issue ? ` · #${m.issue}` : '') + shotNote(m)
          : m.status === 'sending' ? 'Sending…' + (m.shot === 'on' ? ' 📸' : '') + routeNote(m)
          : `<a href="#" class="retry" data-at="${m.at}">⚠ Not sent (no signal?). Tap to retry</a>`}</div></div>`;
      const cls = m.sub === 'banter' || m.sub === 'say' ? 'bot side' : m.sub === 'route' ? 'bot route' : 'bot';
      return `<div class="msg ${cls}"><div class="who">${whoLine(m)}</div><div class="txt">${esc(m.text)}</div></div>`;
    }).join('') : tab === 'direct' ? `<div class="empty">Just you and ${esc(dm.name)}. Michael is not in this chat.<br><br>${dm.teammate ? `${esc(first(dm))} is the real <b>${esc(dm.bot)}</b> teammate: what you send here goes to that bot, and its own answers come back in this thread (✓ real). The office ${esc(first(dm))} answers right away in the meantime.` : `${esc(first(dm))} is an office character (no real bot behind this desk yet): chats in character and does moves like "get out of the way".`}</div>`
      : tab === 'michael' ? `<div class="empty">Michael = the real Grok Bot. Real orders, questions, builds. For a 1:1 with one teammate use 💬 Direct.</div>`
      : `<div class="empty">The whole office in one chat. Small talk and simple moves ("Phyllis, get out of the way") get answered right here for free. Real orders go to Michael (the real Grok Bot).</div>`;
    log.scrollTop = log.scrollHeight;
    try { onLog?.(entries, every.filter(m => !m.thread)); } catch (e) {} // Grok Bot's desk monitor mirrors the office chat (never Direct threads); bubbles react to this device's log
    status.innerHTML = !link.isLinked() ? '<span class="warn">● This browser can\'t encrypt messages. Update iPadOS / Safari</span>'
      : tab === 'direct' ? `<span class="ok">● 1:1 with ${esc(first(dm))} · Michael is not in this chat${dm.teammate ? ` · goes to the real ${esc(dm.bot)}` : ' · office character'}</span>`
      : tab === 'michael' ? '<span class="ok">● Michael = the real Grok Bot · real orders, questions, builds</span>'
      : link.isLinked() ? '<span class="ok">● One office chat · small talk + moves = free office bot · real orders = Michael (Grok Bot)</span>'
      : '<span class="warn">● This browser can\'t encrypt messages. Update iPadOS / Safari</span>';
  }
  function setTarget(s) {
    target = s || target; sel.value = target.id;
    if (tab === 'direct') return;
    try { $('.ctitle').textContent = tab === 'michael' ? 'Michael · the real Grok Bot' : 'Office chat · everyone'; } catch (e) {}
    $('.cname').textContent = target.office ? 'Dunder Mifflin · whole office' : target.bot ? `${target.name} · ${target.bot}` : target.name;
    $('.cdot').style.background = target.color;
    input.placeholder = target.office ? 'Message the office… ("Phyllis, move" works)' : `Message ${target.name}${target.hero ? ' (real Grok Bot)' : ''}…`;
  }
  sel.addEventListener('change', () => { const s = targets.find(s => s.id === sel.value); if (s?.hero) return setTab('michael'); setTarget(s); });

  async function send(text) {
    text = (text || '').trim(); if (!text) return;
    if (tab === 'direct') return sendDirect(text);
    if (tab === 'michael') target = MICHAEL;
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
  // HQ #63: 1:1 with one teammate. Moves still run here instantly; nothing is filed for Michael (Grok Bot).
  async function sendDirect(text) {
    const s = dm, to = s.bot, tri = triage(text.replace(/^\s*(@?grok\b[:,]?|\/grok\b|!grok\b)\s*/i, ''), { to, near: s.id });
    if (tri.cmds.length) try { onCommands?.(tri.cmds, text); } catch (e) {}
    const moveOnly = tri.route === 'office' && tri.kind === 'cmd';
    const m = { kind: 'me', to, text, at: Date.now(), mid: Math.random().toString(36).slice(2, 11), status: 'sending', route: moveOnly ? 'office-cmd' : 'direct', thread: 'dm:' + s.id, direct: { bot: s.id }, noShot: true };
    entries.push(m);
    let line = '';
    if (moveOnly) {
      const c = tri.cmds.find(x => x.bot === s.id) || tri.cmds[0]; line = cmdLine(c.bot, c.act, m.at);
      entries.push({ kind: 'bot', id: 'oc-' + m.mid, from: stOf(c.bot)?.name || s.name, who: c.bot, text: line, at: new Date(m.at + 400).toISOString(), office: true, route: 'direct', thread: m.thread, standin: true });
    }
    render();
    m.office = { near: s.id, bot: tri.cmds.find(x => x.bot === s.id)?.bot || tri.cmds[0]?.bot || null, line };
    await deliver(m);
    fastUntil = Date.now() + 45000; fastPoll();
  }
  async function deliver(m) {
    let shot = null; if (!m.noShot) try { shot = snapshot?.() || null; } catch (e) {}
    m.status = 'sending'; m.shot = m.noShot ? '' : shot ? 'on' : 'off'; render();
    const r = await link.send({ to: m.to, text: m.text, sentAt: new Date(m.at), shot, office: m.office, direct: m.direct, mid: m.mid });
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
      if (r.type === 'ack') { const m = entries.find(e => e.kind === 'me' && e.ref === r.mid); if (m && !m.thread && (m.issue !== r.issue || (r.route && m.route !== r.route))) { m.issue = r.issue; if (r.route) m.route = r.route; else if (r.issue) m.route = 'grok'; added = true; } continue; }
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
    if (open) return; open = true; setTab(tab); chipIdx = -1; markChip();
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
    if (gp.X) { const T = ['michael', 'office', 'direct']; setTab(T[(T.indexOf(tab) + 1) % T.length]); }
    if (gp.LB || gp.RB) {
      if (tab === 'direct') { const i = PEOPLE.indexOf(dm); setDm(PEOPLE[(i + (gp.RB ? 1 : -1) + PEOPLE.length) % PEOPLE.length]); }
      else if (tab === 'office') { const i = targets.indexOf(target); setTarget(targets[(i + (gp.RB ? 1 : -1) + targets.length) % targets.length]); }
    }
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
    draft: () => ({ text: input.value, to: target.id, tab, dm: dm?.id }),
    restoreDraft(d) { if (!d) return; if (d.dm && stOf(d.dm)) dm = stOf(d.dm); if (d.tab) tab = d.tab; const s = targets.find(x => x.id === d.to); if (s) setTarget(s); if (d.text) input.value = d.text; },
    direct(id) { const s = stOf(id); if (s && !s.hero) { dm = s; setTab('direct'); } } };
}
