import React, { useEffect, useState } from 'react';

/**
 * Part photo for the wall TV — people on the floor know a part by sight long
 * before they know its number.
 *
 * TVs run on phone-class chips, and part photos are stored up to 800 px as
 * inline data. Decoding dozens of those while a list scrolls makes the scroll
 * stutter, so each photo is shrunk ONCE to a small copy (kept for the life of
 * the page) and the TV shows the small copy. Linked photos (http) are shown
 * as they are — the browser already caches those.
 */

const small = new Map<string, string>();               // key → small copy ('' = unreadable)
const pending = new Map<string, Promise<string>>();
const MAX_KEPT = 400;
// Streaming sticks (Fire TV) have 1–2 GB for everything; use smaller copies there.
const LOW_MEMORY = typeof navigator !== 'undefined' && ((navigator as any).deviceMemory ?? 8) <= 2;
let queue: Promise<unknown> = Promise.resolve();       // one photo at a time — keeps the scroll smooth

// Cheap identity for a long data URL: its length plus its end (the end of the
// JPEG data differs between photos; the start is the same JPEG header).
const keyFor = (src: string, px: number) => `${px}|${src.length}|${src.slice(-80)}`;

function shrink(src: string, px: number): Promise<string> {
  const run = () => new Promise<string>(resolve => {
    let settled = false;
    const finish = (out: string) => { if (!settled) { settled = true; resolve(out); } };
    const img = new Image();
    const draw = () => {
      if (settled) return;
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return finish('');
        // Shorter side → px, so a square crop (object-cover) stays sharp.
        const scale = px / Math.min(w, h);
        if (scale >= 1) return finish(src);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return finish(src);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', LOW_MEMORY ? 0.75 : 0.82);
        // Free the full-size picture and the canvas now, not whenever the
        // browser gets around to it — matters on a 1 GB TV stick.
        c.width = 0; c.height = 0;
        img.src = '';
        finish(out);
      } catch { finish(src); }
    };
    img.onload = () => {
      // decode() keeps the heavy work off the main thread where supported —
      // but it can wait until the page paints (screen asleep, hidden tab), so
      // don't wait on it for long: one stuck photo would hold up the rest.
      if (typeof img.decode !== 'function') return draw();
      img.decode().then(draw, draw);
      setTimeout(draw, 1500);
    };
    img.onerror = () => finish('');
    setTimeout(() => finish(src), 10_000);   // never stall the queue
    img.src = src;
  });
  const p = queue.then(run, run);
  queue = p;
  return p;
}

function useSmallPhoto(src: string | undefined, requestedPx: number): string | undefined {
  const px = LOW_MEMORY ? Math.round(requestedPx * 0.7) : requestedPx;
  const isData = !!src && src.startsWith('data:');
  const key = isData ? keyFor(src!, px) : '';
  const [, bump] = useState(0);
  useEffect(() => {
    if (!isData || small.has(key)) return;
    let alive = true;
    let p = pending.get(key);
    if (!p) {
      p = shrink(src!, px).then(out => {
        if (small.size >= MAX_KEPT) { const oldest = small.keys().next().value; if (oldest !== undefined) small.delete(oldest); }
        small.set(key, out);
        pending.delete(key);
        return out;
      });
      pending.set(key, p);
    }
    p.then(() => { if (alive) bump(n => n + 1); });
    return () => { alive = false; };
    // key captures src + px
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!src) return undefined;
  if (!isData) return src;
  return small.get(key);          // undefined while shrinking, '' when unreadable
}

export const TvPartPhoto = React.memo(function TvPartPhoto({ src, size, px = 200, frameless = false, fallback, badge }: {
  src?: string;
  /** CSS width = height (e.g. a clamp()). Omit to fill a positioned parent. */
  size?: string;
  /** Short side of the shrunk copy, in pixels. */
  px?: number;
  /** No border or rounding — for a photo that fills a card's top edge. */
  frameless?: boolean;
  /** Shown when there is no usable photo (default: an empty-photo tile). */
  fallback?: React.ReactNode;
  /** Overlaid on the photo — only when a photo shows. */
  badge?: React.ReactNode;
}) {
  const shown = useSmallPhoto(src, px);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [shown]);
  const ok = !!shown && !broken;
  if (!ok && fallback) return <>{fallback}</>;
  // Explicit top/left/width/height (no `inset`) — older TV browsers ignore it.
  const box: React.CSSProperties = size
    ? { width: size, height: size }
    : { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' };
  return (
    <div className={`${size ? 'relative shrink-0' : ''} overflow-hidden bg-zinc-800/80 ${frameless ? '' : 'border border-white/10 rounded-2xl'}`} style={box}>
      {ok ? (
        <img
          src={shown}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setBroken(true)}
          className="block w-full h-full object-cover"
        />
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/15" style={{ position: 'absolute', top: '25%', left: '25%', width: '50%', height: '50%' }}>
          <path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" />
        </svg>
      )}
      {ok && badge}
    </div>
  );
});
