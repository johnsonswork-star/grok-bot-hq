// Network-first service worker: always tries the live site (so redeploys show up immediately),
// falls back to the last cached copy when offline / signal drops.
const CACHE = 'bot-office-v1791688220';
const CORE = ['./', './index.html', './main.js', './stations.js', './workers.js', './monitors.js', './whiteboard.js', './live.js', './chat.js', './hq-link.js', './hq-crypto.js', './vendor/three.module.js', './manifest.webmanifest', './icons/icon-192.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (/\/(version|tasks)\.json$/.test(u.pathname)) return; // live polls: straight to network, never cached
  // no-cache = revalidate with GitHub Pages (ETag) so a fresh deploy is picked up right away, not after the 10 min HTTP cache
  const live = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request, { cache: 'no-cache' });
  e.respondWith(live.then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('./index.html'))));
});
