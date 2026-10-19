// netlify/functions/news.ts
// ─────────────────────────────────────────────────────────────────────
// GET /.netlify/functions/news → aerospace stories for the wall TV.
//
// Reads a FIXED list of public RSS feeds — never a caller-supplied URL, so
// this can't be used as an open proxy — and returns each story's headline,
// source, time, opening lines and a TV-sized picture link, newest first.
// Cached in the function and at the CDN so the TVs don't hammer the
// publishers.
// ─────────────────────────────────────────────────────────────────────

import type { Handler } from '@netlify/functions';
import {
  parseFeed, mergeHeadlines, largerWpCopies, sharePicture, wpCopiesOfOriginal, pictureSize, MAX_PICTURE_WIDTH, type Headline,
} from '../../utils/rss';

// Picked for a shop that makes aerospace parts: the industry and its
// production lines (FlightGlobal), airlines and aircraft orders (Simple
// Flying, AeroTime), military aircraft (Breaking Defense's air desk, The
// Aviationist) and the space business (Payload).
// Tried and dropped: NASA (sent section names like "Software" as
// headlines), Aerospace America (no pictures, mostly obituaries), SpaceNews
// (now mostly webinars and press releases), Defense News (links 6,000-pixel
// originals a TV can't hold).
const FEEDS: { source: string; url: string }[] = [
  { source: 'FlightGlobal', url: 'https://www.flightglobal.com/rss' },
  { source: 'Breaking Defense', url: 'https://breakingdefense.com/category/air/feed/' },
  { source: 'The Aviationist', url: 'https://theaviationist.com/feed/' },
  { source: 'Simple Flying', url: 'https://simpleflying.com/feed/' },
  { source: 'AeroTime', url: 'https://www.aerotime.aero/feed' },
  { source: 'Payload', url: 'https://payloadspace.com/feed/' },
];

const UA = 'FabTrackIO-TV/1.0';
const FRESH_MS = 20 * 60_000;
const FEED_KEEP_MS = 6 * 3_600_000;   // a feed that's down keeps its last stories this long
let cached: { at: number; items: Headline[] } | null = null;
const lastGood = new Map<string, { at: number; items: Headline[] }>();

async function fetchFeed(f: { source: string; url: string }): Promise<Headline[]> {
  try {
    const r = await fetch(f.url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (r.ok) {
      const items = parseFeed((await r.text()).slice(0, 3_000_000), f.source, 5);
      if (items.length) { lastGood.set(f.url, { at: Date.now(), items }); return items; }
    }
  } catch { /* fall back below */ }
  const prev = lastGood.get(f.url);
  return prev && Date.now() - prev.at < FEED_KEEP_MS ? prev.items : [];
}

// ── Pictures ─────────────────────────────────────────────────────────
// Every story gets a picture a 1 GB TV can show sharply: the feed's own
// when it's TV-sized; else the 1024/768-wide copy WordPress keeps of a
// feed's thumbnail; else the picture the story's page shares; a picture of
// unknown size is measured, and a print-size original is never sent.
// Addresses come from the fixed feeds above; only plain https hosts by name.

const safeRemote = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !/^[\d.]+$|^\[|^localhost$/i.test(u.hostname);
  } catch { return false; }
};

// Every lookup stops at one shared deadline, so a slow site can't push the
// reply past the function's time limit. (A signal per request — 100+
// requests on one shared signal sets off Node's listener-leak warning.)
const until = (deadline: number) => AbortSignal.timeout(Math.max(1, deadline - Date.now()));

/** The first address in the list that serves a picture (HEADs run together). */
async function firstPicture(list: { url: string; width: number }[], deadline: number) {
  const found = await Promise.all(list.map(async c => {
    if (!safeRemote(c.url)) return false;
    try {
      const r = await fetch(c.url, { method: 'HEAD', signal: until(deadline), headers: { 'User-Agent': UA } });
      return r.ok && /^image\//i.test(r.headers.get('content-type') || '');
    } catch { return false; }
  }));
  const i = found.indexOf(true);
  return i >= 0 ? list[i] : null;
}

/** The first `max` bytes of a response, even if the server ignored Range. */
async function firstBytes(url: string, max: number, deadline: number, range: boolean): Promise<Buffer | null> {
  if (!safeRemote(url)) return null;
  try {
    const r = await fetch(url, { signal: until(deadline), headers: { 'User-Agent': UA, ...(range ? { Range: `bytes=0-${max - 1}` } : {}) } });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    while (got < max) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(parts);
  } catch { return null; }
}

/**
 * The picture the story's own page shares — only from the feed's own site.
 * A big upload is swapped for WordPress's 1024/768-wide copy of it.
 */
async function pagePicture(h: Headline, feedUrl: string, deadline: number) {
  try {
    if (!h.link) return null;
    const site = new URL(feedUrl).hostname.replace(/^www\./, '');
    if (!new URL(h.link).hostname.endsWith(site)) return null;
    const head = await firstBytes(h.link, 262_144, deadline, false);
    const shared = head ? sharePicture(head.toString('utf8').split(/<\/head>/i)[0]) : null;
    if (shared && shared.width > 1600) return (await firstPicture(wpCopiesOfOriginal(shared.url, shared.width, shared.height), deadline)) || shared;
    return shared;
  } catch { return null; }
}

const pictureMemo = new Map<string, { image?: string; imageWidth?: number }>();

async function tvPicture(h: Headline, feedUrl: string, deadline: number): Promise<void> {
  const key = h.link || h.image || h.title;
  const memo = pictureMemo.get(key);
  if (memo) {
    if (memo.image) { h.image = memo.image; h.imageWidth = memo.imageWidth; } else { delete h.image; delete h.imageWidth; }
    return;
  }
  if (!h.image || (h.imageWidth || 0) < 600) {
    const [copy, page] = await Promise.all([
      h.image ? firstPicture(largerWpCopies(h.image), deadline) : null,
      pagePicture(h, feedUrl, deadline),
    ]);
    const best = copy || page;
    if (best && (best.width >= (h.imageWidth || 0) || !h.image)) { h.image = best.url; h.imageWidth = best.width; }
  }
  if (h.image && !h.imageWidth) {
    const bytes = await firstBytes(h.image, 131_072, deadline, true);
    h.imageWidth = (bytes && pictureSize(bytes)?.w) || 0;
  }
  if (!h.image || !h.imageWidth || h.imageWidth > MAX_PICTURE_WIDTH) { delete h.image; delete h.imageWidth; }
  if (Date.now() < deadline) {   // a lookup cut short isn't remembered — it's retried next time
    if (pictureMemo.size > 300) pictureMemo.clear();
    pictureMemo.set(key, { image: h.image, imageWidth: h.imageWidth });
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: '' };
  if (!cached || Date.now() - cached.at > FRESH_MS) {
    const lists = await Promise.all(FEEDS.map(fetchFeed));
    const items = mergeHeadlines(lists, 24);
    const deadline = Date.now() + 3500;
    const feedOf = new Map(FEEDS.map(f => [f.source, f.url]));
    await Promise.all(items.map(h => tvPicture(h, feedOf.get(h.source) || '', deadline)));
    // Keep the last good list if every feed failed this time.
    if (items.length || !cached) cached = { at: Date.now(), items };
  }
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600',
      'Netlify-CDN-Cache-Control': 'public, s-maxage=1200, stale-while-revalidate=3600',
    },
    body: JSON.stringify({ updatedAt: cached.at, items: cached.items }),
  };
};
