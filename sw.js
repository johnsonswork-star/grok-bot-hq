// The old 3D office registered this worker from the root page.
// It is now a kill switch: drop the caches that worker created, then unregister
// this registration so a Home Screen icon loads the root redirect.
// Do not intercept fetches. A worker registered under /2d/ is a different
// registration and is not touched.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('bot-office')).map(key => caches.delete(key)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
    await Promise.all(clients.map(client => {
      let path = '';
      try { path = new URL(client.url).pathname; } catch (e) { return; }
      // Reload only the old root entry so a Home Screen icon picks up the redirect.
      // Leave /2d/ (and any worker registered there) alone.
      if (/\/2d(\/|$)/.test(path)) return;
      if (!(path.endsWith('/') || path.endsWith('/index.html'))) return;
      return client.navigate(client.url);
    }));
  })());
});
