// Service worker: makes the app installable and lets it open when offline.
// It always tries the network first, so people get the newest version,
// and only falls back to the saved copy when there is no connection.

const CACHE = 'street-property-shell-v4';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    // "no-cache" makes the browser check with the server every time, so a new
    // version of the app is picked up at once instead of after the browser's
    // own cache expires (up to 10 minutes on GitHub Pages).
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(async (cache) => {
            await cache.put(request, copy);
            // Files have versioned addresses (?v=...): keep only the newest copy of each.
            const url = new URL(request.url);
            if (!url.searchParams.has('v')) return;
            for (const old of await cache.keys()) {
              const oldUrl = new URL(old.url);
              if (oldUrl.pathname === url.pathname && oldUrl.search !== url.search) await cache.delete(old);
            }
          });
        }
        return response;
      })
      .catch(() => caches.match(request).then((saved) => saved ?? Response.error())),
  );
});
