// FabTrack IO — Service Worker
// __BUILD_HASH__ is replaced at build time by scripts/stamp-sw.mjs so every
// deploy gets a unique CACHE_NAME → old caches are evicted automatically.
const CACHE_NAME = 'fabtrack-__BUILD_HASH__';
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

  // ── Hashed assets (/assets/*): cache-first — Vite fingerprints every file
  //    so a cache hit is always the correct version.
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

  // ── HTML (index.html / app shell): NEVER cache.
  //
  // Caching HTML caused the most common worker black-screen: a new deploy
  // would roll out new hashed bundles (index-ABC.js → index-XYZ.js) but
  // the SW kept serving the old index.html that still referenced the old
  // hash.  The old bundle was gone → 404 → blank screen → workers had to
  // kill and reopen the app.
  //
  // Fix: always fetch HTML from the network.  If offline, show a simple
  // "You're offline, connect and try again" page instead of a broken app.
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          `<!doctype html><html lang="en"><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>FabTrack IO — Offline</title>
          <style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#09090b;font-family:system-ui,sans-serif;color:#fff;text-align:center;padding:24px}h2{font-size:1.4rem;font-weight:900;margin:0 0 8px}p{color:#71717a;font-size:.9rem;margin:0 0 20px}button{background:linear-gradient(135deg,#f97316,#f59e0b);color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:.95rem;font-weight:700;cursor:pointer}</style>
          </head><body>
          <div><div style="font-size:2.5rem;margin-bottom:16px">📡</div>
          <h2>You're offline</h2>
          <p>Connect to Wi-Fi or mobile data and try again.</p>
          <button onclick="window.location.reload()">Retry</button></div>
          </body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  // ── Everything else: network-first, cache as fallback ──
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
// Push payloads come from the server as JSON, but occasionally arrive as
// plain text (Apple push in particular can be empty or raw string). Parse
// defensively so a malformed payload never crashes the SW — otherwise the
// entire push pipeline dies for that device until the SW is re-registered.
self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch {
      try { data = { body: event.data.text() }; }
      catch { data = {}; }
    }
  }
  const title = data.title || 'FabTrack IO';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/brand/ftio-icon.png',
    badge: '/brand/ftio-icon.png',
    tag: data.tag || 'fabtrack',
    // userId stored here so notificationclick can call timer-action without the app open
    data: { url: data.url || '/', logId: data.logId, userId: data.userId, action: data.action },
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: Pause / Resume / Stop from the lock screen ──
//
// TWO paths depending on whether the app is open:
//
//   APP OPEN   → postMessage to the app so it can update local state and Firestore
//   APP CLOSED → call /.netlify/functions/timer-action directly from the SW
//                (true background action — no app needed at all)
//
self.addEventListener('notificationclick', event => {
  const { action } = event;
  const { url = '/', logId, userId } = event.notification.data || {};
  event.notification.close();

  if (action && logId) {
    event.waitUntil((async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

      if (allClients.length > 0) {
        // ── App is open: let it handle state + Firestore ──────────────
        for (const c of allClients) {
          c.postMessage({ type: 'TIMER_ACTION', action, logId });
        }
        if ('focus' in allClients[0]) allClients[0].focus();
        return;
      }

      // ── App is closed: call backend directly ──────────────────────
      try {
        const res = await fetch('/.netlify/functions/timer-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, logId, userId }),
        });
        const result = await res.json().catch(() => ({}));

        if (result.ok) {
          // Show a brief confirmation — replaces the timer notification
          await self.registration.showNotification(result.message || '✓ Done', {
            body: 'Tap to open FabTrack IO',
            icon: '/brand/ftio-icon.png',
            badge: '/brand/ftio-icon.png',
            tag: `timer-confirm-${logId}`,
            data: { url: '/' },
            requireInteraction: false,
          });
          // If it was a stop, also clear the live-timer notification
          if (action === 'stop') {
            const timerNotifs = await self.registration.getNotifications({ tag: `live-timer-${logId}` });
            timerNotifs.forEach(n => n.close());
          }
        } else {
          // Something went wrong — open the app so they can deal with it
          await clients.openWindow(`${url}?action=${action}&logId=${encodeURIComponent(logId)}`);
        }
      } catch {
        // Network error / function down — open app as fallback
        await clients.openWindow(`${url}?action=${action}&logId=${encodeURIComponent(logId)}`);
      }
    })());
    return;
  }

  // No action button — just open / focus the app
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
  // Force-activate this SW immediately — the page calls this when a new
  // version finishes installing so users never get stuck on a stale shell.
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'NOTIFY') {
    const { title, body, tag, url, actions, logId, userId, requireInteraction } = data;
    self.registration.showNotification(title, {
      body,
      icon: '/brand/ftio-icon.png',
      badge: '/brand/ftio-icon.png',
      tag: tag || 'fabtrack',
      data: { url: url || '/', logId, userId, action: data.action },
      vibrate: [200, 100, 200],
      requireInteraction: !!requireInteraction,
      actions: actions || [],
    });
  }
  if (data.type === 'CANCEL_NOTIFICATION' && data.tag) {
    self.registration.getNotifications({ tag: data.tag }).then(list => list.forEach(n => n.close()));
  }
});