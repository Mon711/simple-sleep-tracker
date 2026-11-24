/* global self, caches, fetch */
const offlineCache = 'sleep-tracker-offline-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(offlineCache).then(cache => cache.addAll(['/offline.html', '/offline.css'])));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('sleep-tracker-offline-') && key !== offlineCache)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/offline.css') {
    event.respondWith(caches.open(offlineCache).then(cache => cache.match('/offline.css')).then(response =>
      response ?? fetch(event.request)));
    return;
  }
  if (event.request.mode !== 'navigate' || url.pathname !== '/') return;
  // This worker never reads or caches API responses, downloads, or sign-in pages.
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
