// Live reload: when a new build is deployed (deploy.sh writes version.json), the office reloads itself
// at a safe moment (not while a chat message is sending or being typed) and puts you back where you were.
const KEY = 'hq.resume', POLL_MS = 20000;

export function takeResume() {
  try {
    const r = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY);
    return r && Date.now() - r.at < 120000 ? r : null;
  } catch (e) { return null; }
}

export function startLiveReload({ getState, isSafe, toast }) {
  let base = null, pending = false;
  async function check() {
    if (document.hidden) return;
    try {
      const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const { build } = await r.json();
      if (!build) return;
      if (base === null) { base = build; return; }
      if (build !== base && !pending) { pending = true; toast?.('New office update: reloading…'); waitAndReload(); }
    } catch (e) {}
  }
  async function waitAndReload() {
    if (!isSafe()) return setTimeout(waitAndReload, 1500); // e.g. mid-send or typing: try again shortly
    try { const reg = await navigator.serviceWorker?.getRegistration?.(); await reg?.update?.(); } catch (e) {}
    try { sessionStorage.setItem(KEY, JSON.stringify({ ...getState(), at: Date.now() })); } catch (e) {}
    setTimeout(() => location.reload(), 600);
  }
  check(); setInterval(check, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  return { check };
}
