// ═════════════════════════════════════════════════════════════════════
// Developer mode — hides tech/diagnostic panels from shop-owner users.
//
// Panels like "AI Status", "Firebase Connection", "Push Registration",
// and raw VAPID/env guidance are useful to the SaaS operator (us) but
// confusing — sometimes alarming — to a shop owner who just bought the
// product. They should "just work" out of the box.
//
// A user is treated as a developer when ANY of:
//   • URL contains ?dev=1  (toggleable — also writes to localStorage)
//   • URL contains ?dev=0  (clears the flag)
//   • localStorage['sc_dev_mode'] === '1'  (persistent)
//   • Running on localhost / 127.0.0.1  (local dev server)
//
// Nothing destructive is ever gated — only DIAGNOSTIC UI. Real features
// (AI scanner, push notifications, Firestore writes) always work if the
// backend is configured, regardless of dev mode.
// ═════════════════════════════════════════════════════════════════════

const LS_KEY = 'sc_dev_mode';

/** Parse once on module load so subsequent calls are cheap. */
function initDevFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('dev') === '1') {
      localStorage.setItem(LS_KEY, '1');
      return true;
    }
    if (qs.get('dev') === '0') {
      localStorage.removeItem(LS_KEY);
      return false;
    }
    if (localStorage.getItem(LS_KEY) === '1') return true;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
  } catch {}
  return false;
}

const devFlag = initDevFlag();

export function isDeveloper(): boolean {
  return devFlag;
}
