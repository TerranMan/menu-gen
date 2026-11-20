// CACHE_VERSION и PRECACHE_FILES добавляет Vite из production-сборки.
const scope = self.registration.scope;
const shellUrl = new URL('./', scope).href;
const shellPath = new URL(shellUrl).pathname;
const precacheUrls = new Set(PRECACHE_FILES.map((file) => new URL(file, scope).href));
const cachePrefix = `menu-gen:${scope}:`;
const cacheName = cachePrefix + CACHE_VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...precacheUrls].map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;

  const path = new URL(request.url).pathname;
  const menuNavigation = request.mode === 'navigate' && (path === shellPath || path === `${shellPath}index.html`);
  if (menuNavigation || precacheUrls.has(request.url)) {
    const url = menuNavigation ? shellUrl : request.url;
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(url)) ?? fetch(request);
    })());
  } else if (request.destination === 'image') {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
          await cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return Response.error();
      }
    })());
  }
});
