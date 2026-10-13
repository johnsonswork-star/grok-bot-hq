// HQ #92: Suggestion Box for the Design Trainer wall. Tap SUGGEST on the wall → this overlay opens so the iPad
// keyboard can type a design/phrase idea. Submit sends type:'suggest' through the encrypted HQ relay (hq-link.sendSuggest);
// the box appends it to ~/.config/grok-bot-hq/design-train/suggestions.jsonl for Kelly's next deck.
import { sendSuggest, isLinked } from './hq-link.js';

const KEY = 'hq.suggest.recent';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
const save = a => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-12))); } catch (e) {} };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createSuggestBox({ onOpenChange, getContext = () => ({}), toast = () => {}, onSent = () => {} }) {
  const el = document.getElementById('suggest');
  if (!el) throw new Error('missing #suggest overlay');
  const input = el.querySelector('textarea'), status = el.querySelector('.sstatus'), recent = el.querySelector('.srecent');
  const form = el.querySelector('form'), cx = el.querySelector('.sx');
  let open = false, sending = false, cardId = null;

  function renderRecent() {
    const rows = load().slice().reverse().slice(0, 5);
    recent.innerHTML = rows.length
      ? `<div class="slab">Recent (this iPad)</div>` + rows.map(r =>
          `<div class="srow"><b>${esc((r.text || '').slice(0, 80))}</b><span>${r.ok === false ? '⚠ not sent' : '✓ to Kelly'} · ${esc(r.hm || '')}</span></div>`).join('')
      : `<div class="sempty">Ideas you send land in Kelly’s suggestion box for the next design deck.</div>`;
  }
  function setStatus(html) { status.innerHTML = html; }

  function show(ctx = {}) {
    if (open) return; open = true;
    cardId = ctx.cardId || getContext()?.cardId || null;
    const label = ctx.cardTitle || getContext()?.cardTitle || '';
    el.querySelector('.scard').textContent = label ? `While looking at: ${label}` : 'Any design / phrase idea for Kelly';
    el.classList.add('open'); document.documentElement.classList.add('suggesting');
    setStatus(isLinked() ? '<span class="ok">● Encrypted to Kelly’s suggestion box</span>' : '<span class="warn">● This browser can’t encrypt. Update iPadOS / Safari</span>');
    renderRecent();
    onOpenChange?.(true);
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 80);
  }
  function close() {
    if (!open) return; open = false; input.blur();
    el.classList.remove('open'); document.documentElement.classList.remove('suggesting');
    onOpenChange?.(false);
  }

  async function submit() {
    const text = (input.value || '').trim(); if (!text || sending) return;
    if (!isLinked()) { setStatus('<span class="warn">● Can’t encrypt on this browser</span>'); return; }
    sending = true; setStatus('<span class="ok">● Sending…</span>');
    const ctx = getContext() || {};
    const r = await sendSuggest({ text, cardId: cardId || ctx.cardId || null, deck: ctx.deckId || null });
    const hm = (() => { try { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } })();
    const rows = load(); rows.push({ text, at: Date.now(), hm, ok: !!r.ok, mid: r.mid || '', cardId: cardId || null }); save(rows);
    sending = false;
    if (r.ok) {
      input.value = '';
      setStatus('<span class="ok">● Sent to Kelly ✓</span>');
      toast('✉ Sent to Kelly · she’ll use it for the next deck', 2200);
      onSent?.({ text, mid: r.mid, cardId });
      renderRecent();
      setTimeout(close, 700);
    } else {
      setStatus('<span class="warn">● Not sent (no signal?). Tap Send to retry</span>');
      toast('Suggestion didn’t send — try again', 2200);
      renderRecent();
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  cx.addEventListener('click', () => close());
  el.querySelector('.scancel')?.addEventListener('click', () => close());
  // Enter sends (Shift+Enter = newline) — matches chat feel on iPad keyboard
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });

  function pad(gp) {
    if (!open || !gp) return;
    if (gp.B) return close();
    if (gp.A) { if (input.value.trim()) submit(); else input.focus(); }
  }

  renderRecent();
  return {
    show, close, toggle: () => (open ? close() : show()),
    isOpen: () => open, isTyping: () => document.activeElement === input, pad,
    recent: () => load().slice(),
  };
}
