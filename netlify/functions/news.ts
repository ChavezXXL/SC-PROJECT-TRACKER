// netlify/functions/news.ts
// ─────────────────────────────────────────────────────────────────────
// GET /.netlify/functions/news → aerospace headlines for the wall TV.
//
// Reads a FIXED list of public RSS feeds — never a caller-supplied URL, so
// this can't be used as an open proxy — and returns headlines only (title,
// source, time), newest first. Cached in the function and at the CDN so
// the TVs don't hammer the publishers.
// ─────────────────────────────────────────────────────────────────────

import type { Handler } from '@netlify/functions';
import { parseFeed, mergeHeadlines, type Headline } from '../../utils/rss';

const FEEDS: { source: string; url: string }[] = [
  { source: 'FlightGlobal', url: 'https://www.flightglobal.com/rss' },
  { source: 'SpaceNews', url: 'https://spacenews.com/feed/' },
  { source: 'Aerospace America', url: 'https://aerospaceamerica.aiaa.org/feed/' },
  { source: 'NASA', url: 'https://www.nasa.gov/feed/' },
  { source: 'Defense News', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/category/air/?outputType=xml' },
  { source: 'The Aviationist', url: 'https://theaviationist.com/feed/' },
];

const FRESH_MS = 20 * 60_000;
let cached: { at: number; items: Headline[] } | null = null;

async function fetchFeed(f: { source: string; url: string }): Promise<Headline[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(f.url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'FabTrackIO-TV/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!r.ok) return [];
    const xml = (await r.text()).slice(0, 3_000_000);
    return parseFeed(xml, f.source, 5);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: '' };
  if (!cached || Date.now() - cached.at > FRESH_MS) {
    const items = mergeHeadlines(await Promise.all(FEEDS.map(fetchFeed)), 24);
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
