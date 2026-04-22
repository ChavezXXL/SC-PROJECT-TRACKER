// SC Deburring Job Tracker - Service Worker v1
const CACHE_NAME = 'sc-tracker-v2';
const OFFLINE_URL = '/';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/index.tsx',
];

// ── Install: cache shell ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: remove old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy ───────────────────────────────────────────────
// Hashed assets (/assets/*) → cache-first (they never change, save bandwidth)
// Everything else → network-first with cache fallback
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Skip third-party requests
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('google') ||
      url.hostname.includes('esm.sh') ||
      url.hostname.includes('fonts') ||
      url.hostname.includes('tailwindcss') ||
      url.hostname.includes('cdn')) return;

  // Cache-first for hashed assets (Vite fingerprints them, so they're immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Network-first for HTML and other non-hashed resources
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match(OFFLINE_URL)))
  );
});

// ── Push Notifications ────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'SC Deburring';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    tag: data.tag || 'sc-tracker',
    data: { url: data.url || '/', logId: data.logId, action: data.action },
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open/focus app + handle action buttons ───
// Action buttons (Pause / Resume / Stop) can be tapped without opening the app
self.addEventListener('notificationclick', event => {
  const { action } = event;
  const { url = '/', logId } = event.notification.data || {};
  event.notification.close();

  // If an action button was tapped, post a message to any open client
  // so the main app can dispatch the pause/resume/stop
  if (action && logId) {
    event.waitUntil((async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Notify all open clients — message shape matches existing TIMER_ACTION handler
      for (const c of allClients) {
        c.postMessage({ type: 'TIMER_ACTION', action, logId });
      }
      // If no client is open, open the app with the action in the URL
      if (allClients.length === 0) {
        const target = `${url}${url.includes('?') ? '&' : '?'}action=${action}&logId=${encodeURIComponent(logId)}`;
        return clients.openWindow(target);
      }
      // Focus the first open client
      if ('focus' in allClients[0]) return allClients[0].focus();
    })());
    return;
  }

  // No action = just open/focus the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── Message handler: let the app schedule + trigger notifications ──
// The app posts `{type:'NOTIFY', title, body, tag, url, actions, logId}` to show a notification
// or `{type:'SCHEDULE', at, payload}` to schedule one for later (stored in IndexedDB)
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;
  if (data.type === 'NOTIFY') {
    const { title, body, tag, url, actions, logId, requireInteraction } = data;
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: tag || 'sc-tracker',
      data: { url: url || '/', logId, action: data.action },
      vibrate: [200, 100, 200],
      requireInteraction: !!requireInteraction,
      actions: actions || [],
    });
  }
  if (data.type === 'CANCEL_NOTIFICATION' && data.tag) {
    self.registration.getNotifications({ tag: data.tag }).then(list => list.forEach(n => n.close()));
  }
});