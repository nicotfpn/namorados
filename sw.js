const CACHE_VERSION = 'noites-tematicas-v4';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/dist/style.min.css',
  '/dist/main.min.js'
];

const OPTIONAL_ASSETS = [
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await Promise.allSettled(
        OPTIONAL_ASSETS.map((url) =>
          fetch(url).then((res) => {
            if (res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) return;

  const isNavigation = event.request.mode === 'navigate';
  const isHTML = isNavigation || url.pathname === '/' || url.pathname.endsWith('.html');

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request)
            .then((cached) => cached || caches.match('/index.html'))
            .then((fallback) => fallback || new Response('Offline', {
              status: 503,
              headers: { 'Content-Type': 'text/html' }
            }))
        )
    );
    return;
  }

  const cleanUrl = url.origin + url.pathname;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(cleanUrl, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(cleanUrl)
          .then((cached) => cached || caches.match(event.request))
          .then((fallback) => fallback || new Response('', { status: 503 }))
      )
  );
});
