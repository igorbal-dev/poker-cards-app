// Service worker: офлайн-кэш приложения и карточек.
// При изменении оболочки приложения увеличьте VERSION.
const VERSION = 'v12';
const CACHE = 'poker-cards-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.json', 'cards.json',
  'fonts/inter-cyrillic.woff2', 'fonts/inter-latin.woff2',
  'fonts/jetbrains-mono-cyrillic.woff2', 'fonts/jetbrains-mono-latin.woff2',
  'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // все карточки из cards.json
    try {
      const data = await (await fetch('cards.json', { cache: 'no-cache' })).json();
      await cache.addAll((data.cards || data).map((c) => c.file));
    } catch (e) { /* догрузятся при просмотре */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('poker-cards-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// cards.json и страница — сначала сеть (чтобы видеть новые карточки), иначе кэш.
// Остальное — сразу из кэша, с обновлением в фоне.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const networkFirst = req.mode === 'navigate' || url.pathname.endsWith('/cards.json');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
      return res;
    });
    if (networkFirst) {
      try { return await fromNet; } catch (e) {
        return (await cache.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true })) || Response.error();
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) { event.waitUntil(fromNet.catch(() => {})); return hit; }
    return fromNet;
  })());
});
