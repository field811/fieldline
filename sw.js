// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = 'fieldline-v8';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/scoring.js', 'js/demo.js', 'js/import-worker.js', 'js/hr-chart.js', 'js/insights.js', 'js/journal.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
