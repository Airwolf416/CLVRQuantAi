const CACHE_NAME = 'clvrquant-v4';
const STATIC_ASSETS = ['/', '/manifest.json', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-1024.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && url.origin === self.location.origin) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// ── Notification requests from the app page ──────────────
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'SHOW_NOTIFICATION') return;
  const { title, body, tag, icon } = e.data;
  e.waitUntil(
    self.registration.showNotification(title || 'CLVRQuant', {
      body: body || '',
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: tag || 'clvrquant',
      vibrate: [200, 100, 200],
      data: { url: '/' }
    })
  );
});

// ── Server-side push notifications (future) ──────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'CLVRQuant', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'CLVRQuant', {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'clvrquant',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

// ── Notification click → bring app to foreground ─────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
