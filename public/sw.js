// FabTrack IO — Service Worker
// __BUILD_HASH__ is replaced at build time by scripts/stamp-sw.mjs so every
// deploy gets a unique CACHE_NAME → old caches are evicted automatically.
const CACHE_NAME = 'fabtrack-__BUILD_HASH__';
const OFFLINE_URL = '/';

// Only pre-cache the app shell root.
// DO NOT include /index.tsx — it does not exist in production builds.
// DO NOT include /index.html — it is fetched network-first anyway.
// Hashed /assets/* files are cached on first fetch, not at install time.
const PRECACHE_ASSETS = ['/'];

// ── Install: cache shell ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => {
        // Pre-cache failure (offline at install time) must not block activation.
        console.warn('[SW] Pre-cache failed, activating anyway:', err);
        return self.skipWaiting();
      })
  );
});

// ── Activate: remove old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch strategy ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Skip ALL third-party requests — Firebase, Google, CDNs, fonts, etc.
  if (url.hostname !== self.location.hostname) return;

  // ── Hashed assets (/assets/*): cache-first with network fallback ──
  // Vite fingerprints every filename, so a cache hit is always the right
  // version. On a miss, fetch from network and cache it.
  // If BOTH cache and network fail (bad signal), return a 503 so the
  // browser reports a clear error instead of hanging or silently returning
  // a junk response.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(response => {
            if (response && response.status >= 200 && response.status < 300) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
            }
            return response;
          })
          .catch(() => new Response('', { status: 503, statusText: 'Asset unavailable offline' }));
      })
    );
    return;
  }

  // ── HTML (/ and *.html): ALWAYS network-first, never serve from cache. ──
  // Serving cached HTML was the root cause of the "blank screen on open"
  // bug: new deploys change bundle hashes in index.html, but the cached
  // copy still references old (deleted) hashes → 404s → white screen.
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          `<!doctype html><html lang="en"><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>FabTrack IO — Offline</title>
          <style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#09090b;font-family:system-ui,sans-serif;color:#fff;text-align:center;padding:24px}h2{font-size:1.4rem;font-weight:900;margin:0 0 8px}p{color:#71717a;font-size:.9rem;margin:0 0 20px}button{background:linear-gradient(135deg,#f97316,#f59e0b);color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:.95rem;font-weight:700;cursor:pointer}</style>
          </head><body><div><div style="font-size:2.5rem;margin-bottom:16px">📡</div>
          <h2>You're offline</h2><p>Connect to Wi-Fi or mobile data and try again.</p>
          <button onclick="window.location.reload()">Retry</button></div></body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        )
      )
    );
    return;
  }

  // ── Everything else: network-first, stale cache as fallback ────────
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status >= 200 && response.status < 300) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(r =>
          r || new Response('', { status: 503, statusText: 'Offline' })
        )
      )
  );
});

// ── Push Notifications ────────────────────────────────────────────
// Parse defensively — a malformed payload must never crash the SW.
self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch { try { data = { body: event.data.text() }; } catch { data = {}; } }
  }
  const title = data.title || 'FabTrack IO';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/brand/ftio-icon.png',
    badge: '/brand/ftio-icon.png',
    tag: data.tag || 'fabtrack',
    data: { url: data.url || '/', logId: data.logId, userId: data.userId, action: data.action },
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ──────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  const { action } = event;
  const { url = '/', logId, userId } = event.notification.data || {};
  event.notification.close();

  if (action && logId) {
    event.waitUntil((async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (allClients.length > 0) {
        for (const c of allClients) c.postMessage({ type: 'TIMER_ACTION', action, logId });
        if ('focus' in allClients[0]) allClients[0].focus();
        return;
      }
      try {
        const res = await fetch('/.netlify/functions/timer-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, logId, userId }),
        });
        const result = await res.json().catch(() => ({}));
        if (result.ok) {
          await self.registration.showNotification(result.message || '✓ Done', {
            body: 'Tap to open FabTrack IO', icon: '/brand/ftio-icon.png',
            badge: '/brand/ftio-icon.png', tag: `timer-confirm-${logId}`,
            data: { url: '/' }, requireInteraction: false,
          });
          if (action === 'stop') {
            const timerNotifs = await self.registration.getNotifications({ tag: `live-timer-${logId}` });
            timerNotifs.forEach(n => n.close());
          }
        } else {
          await clients.openWindow(`${url}?action=${action}&logId=${encodeURIComponent(logId)}`);
        }
      } catch {
        await clients.openWindow(`${url}?action=${action}&logId=${encodeURIComponent(logId)}`);
      }
    })());
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// ── Message handler ──────────────────────────────────────────────────
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'NOTIFY') {
    const { title, body, tag, url, actions, logId, userId, requireInteraction, silent } = data;
    self.registration.showNotification(title, {
      body, icon: '/brand/ftio-icon.png', badge: '/brand/ftio-icon.png',
      tag: tag || 'fabtrack',
      data: { url: url || '/', logId, userId, action: data.action },
      vibrate: silent ? [] : [200, 100, 200],
      silent: !!silent,
      requireInteraction: !!requireInteraction,
      actions: actions || [],
    });
  }
  if (data.type === 'CANCEL_NOTIFICATION' && data.tag) {
    self.registration.getNotifications({ tag: data.tag }).then(list => list.forEach(n => n.close()));
  }
});
