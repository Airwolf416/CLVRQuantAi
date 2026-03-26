const CACHE_NAME = 'clvrquant-v7';
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

// ── Build the notification options object (shared by push + message) ─────────
function buildNotifOptions(data = {}) {
  const origin = self.location.origin;
  // Always use absolute URLs for icon/badge — relative paths fail on lock screen
  // because the OS fetches the image independently outside the browser context
  const icon  = data.icon  && data.icon.startsWith('http') ? data.icon  : `${origin}/icons/icon-512.png`;
  const badge = data.badge && data.badge.startsWith('http') ? data.badge : `${origin}/icons/icon-192.png`;
  return {
    body: data.body || '',
    icon,
    badge,
    tag: data.tag || 'clvrquant',
    // renotify: show a new notification even when tag already exists on screen
    renotify: true,
    // requireInteraction: false so iOS dismisses it normally (true blocks it on iOS)
    requireInteraction: false,
    // silent: false to allow sound + vibration on lock screen
    silent: false,
    vibrate: [300, 100, 300, 100, 200],
    timestamp: data.timestamp || Date.now(),
    data: { url: data.url || '/' },
  };
}

// ── Notification requests from the app page (in-app toasts) ──────────────────
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'SHOW_NOTIFICATION') return;
  e.waitUntil(
    self.registration.showNotification(e.data.title || 'CLVRQuant', buildNotifOptions(e.data))
  );
});

// ── Server-side Web Push (fires even when app is closed / screen locked) ─────
self.addEventListener('push', (e) => {
  let data = {};
  try {
    if (e.data) data = e.data.json();
  } catch {
    data = { title: 'CLVRQuant', body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'CLVRQuant';
  e.waitUntil(
    self.registration.showNotification(title, buildNotifOptions(data))
  );
});

// ── Notification click → bring app to foreground (no reload) ──────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus the existing app window without navigating (avoids page reload / state reset)
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // No existing window — open a new one
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ── Keep service worker alive: respond to periodic sync (if supported) ────────
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'clvr-keep-alive') {
    e.waitUntil(Promise.resolve());
  }
});
