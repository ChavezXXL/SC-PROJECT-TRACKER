// Tiny RSS 2.0 / Atom reader for the wall-TV news slide — headline, time,
// the story's opening lines and a picture, no dependencies. Used by
// netlify/functions/news.ts and its tests.

export interface Headline {
  title: string;
  source: string;
  at: number;        // publish time (ms), 0 when the feed gave none
  summary?: string;  // the story's opening lines, plain text
  image?: string;    // https picture small enough for a TV (never a print-size original)
  imageWidth?: number; // its width in pixels, when the feed (or a check) told us
  link?: string;     // the story's own page
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function cleanText(raw: string): string {
  let s = decodeEntities(unCdata(raw));
  s = s.replace(/<[^>]*>/g, ' ');           // markup inside a title
  s = decodeEntities(s);                     // some feeds double-encode (&amp;#8217;)
  return s.replace(/\s+/g, ' ').trim();
}

function firstTag(block: string, names: string[]): string {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? '').trim() : '';
}

// ── Pictures ─────────────────────────────────────────────────────────
// Feeds hang a picture on a story in several ways (media:content,
// media:thumbnail, enclosure, an <img> in the story HTML). Pick one a 1–2 GB
// TV can show: some feeds link 6,000-pixel originals (a 100+ MB bitmap once
// decoded), so a picture known to be that big is never used.

export const MAX_PICTURE_WIDTH = 2600;
const NOT_A_PHOTO = /gravatar|feedburner|doubleclick|pixel|emoji|wp-includes|\/ads?\/|logo|avatar|\.(svg|gif)(\?|$)/i;

/** Width a WordPress resized copy carries in its name (photo-480x320.jpg → 480), else 0. */
export function wpWidth(url: string): number {
  const m = url.match(/-(\d{2,4})x(\d{2,4})\.(?:jpe?g|png|webp)(?:[?#]|$)/i);
  return m ? Number(m[1]) : 0;
}

function httpsUrl(raw: string): string {
  let u = raw.trim();
  if (u.startsWith('//')) u = 'https:' + u;
  else if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  return /^https:\/\/[^\s"'<>]+$/i.test(u) && !NOT_A_PHOTO.test(u) ? u : '';
}

/**
 * The story's picture: from media:content / media:thumbnail / enclosure, or
 * an <img> in the short description (never the full article body — that's
 * where ads and charts live). A picture whose size is known wins over one
 * whose size isn't, and one known to be huge is never used.
 */
export function pickPicture(block: string): { url: string; width: number } | null {
  const found: { url: string; width: number }[] = [];
  for (const t of block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi) || []) {
    const type = attr(t, 'type'), medium = attr(t, 'medium');
    if ((type && !/^image\//i.test(type)) || (medium && medium.toLowerCase() !== 'image')) continue;
    found.push({ url: attr(t, 'url'), width: Number(attr(t, 'width')) || 0 });
  }
  // In the description — raw inside CDATA, or entity-encoded.
  for (const t of decodeEntities(unCdata(firstTag(block, ['description', 'summary']))).match(/<img\b[^>]*>/gi) || []) {
    const src = attr(t, 'src');
    found.push({ url: /^(https?:)?\/\//i.test(src) ? src : attr(t, 'data-src') || attr(t, 'data-lazy-src'), width: Number(attr(t, 'width')) || 0 });
  }
  const widest = new Map<string, number>();   // url → largest width any tag gave it (0 = unknown)
  for (const f of found) {
    const url = httpsUrl(f.url);
    if (url) widest.set(url, Math.max(widest.get(url) ?? 0, f.width || wpWidth(url)));
  }
  let best: { url: string; width: number } | null = null, bestScore = 0;
  for (const [url, width] of widest) {
    if (width > MAX_PICTURE_WIDTH || (width > 0 && width < 120)) continue;   // too big for the TV / an icon
    const score = width >= 600 ? 3 : width > 0 ? 2 : 1;    // TV-sized, then a small copy, then unknown
    if (score > bestScore) { best = { url, width }; bestScore = score; }
  }
  return best;
}

/** Pixel size read from the first bytes of a JPEG, PNG or WebP file. */
export function pictureSize(b: Uint8Array): { w: number; h: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => b[i] * 0x1000000 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const text = (i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  if (b.length >= 24 && b[0] === 0x89 && text(1).startsWith('PNG')) return { w: u32(16), h: u32(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }                                     // fill byte
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }      // no length
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) };
      i += 2 + u16(i + 2);
    }
    return null;
  }
  if (b.length >= 30 && text(0) === 'RIFF' && text(8) === 'WEBP') {
    const kind = text(12);
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  return null;
}

/** Ask image services that resize on request for a TV-sized copy. */
export function tvSizedPicture(url: string): string {
  // Simple Flying's picture service (static0.simpleflyingimages.com) sends
  // 4 MB originals unless asked for a size.
  if (/^https:\/\/static\d*\.[a-z0-9-]+images\.com\//i.test(url) && !url.includes('?')) return `${url}?q=70&fit=crop&w=960&h=540&dpr=1`;
  return url;
}

/**
 * Some feeds link a 460–480-wide copy of a photo — soft on a big screen.
 * WordPress also keeps 1024- and 768-wide copies named after their size;
 * the height comes from the photo's shape, known only to ±1 px from the
 * small copy, so these are the names to try, best first. (A square copy is
 * usually a crop, which says nothing about the photo's shape.)
 */
export function largerWpCopies(url: string): { url: string; width: number }[] {
  const m = url.match(/^(.*)-(\d{2,4})x(\d{2,4})(\.(?:jpe?g|png|webp))$/i);
  if (!m) return [];
  const w = Number(m[2]), h = Number(m[3]);
  if (w >= 700 || w < 120 || w === h) return [];
  const out: { url: string; width: number }[] = [];
  for (const W of [1024, 768]) {
    const mid = Math.round((W * h) / w);
    const lo = Math.round((W * (h - 0.5)) / w), hi = Math.round((W * (h + 0.5)) / w);
    const heights = [mid];
    for (let d = 1; mid - d >= lo || mid + d <= hi; d++) {
      if (mid + d <= hi) heights.push(mid + d);
      if (mid - d >= lo) heights.push(mid - d);
    }
    for (const x of heights) out.push({ url: `${m[1]}-${W}x${x}${m[4]}`, width: W });
  }
  return out;
}

/**
 * The picture a story's own page shares (og:image / twitter:image), read
 * from the top of the page's HTML — for stories whose feed sent none, or
 * only a thumbnail.
 */
export function sharePicture(html: string): { url: string; width: number; height: number } | null {
  const meta = (name: string) => {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i'));
    return tag ? attr(tag[0], 'content') : '';
  };
  const url = httpsUrl(meta('og:image') || meta('og:image:url') || meta('twitter:image'));
  if (!url) return null;
  return { url, width: Number(meta('og:image:width')) || wpWidth(url), height: Number(meta('og:image:height')) || 0 };
}

/**
 * The 1024- and 768-wide copies WordPress keeps of a full-size upload
 * (photo.jpg or photo-scaled.jpg) whose exact size is known.
 */
export function wpCopiesOfOriginal(url: string, w: number, h: number): { url: string; width: number }[] {
  const m = url.match(/^(.*?)(?:-scaled)?(\.(?:jpe?g|png|webp))$/i);
  if (!m || !(w > 1024) || !(h > 0) || /-\d{2,4}x\d{2,4}$/.test(m[1])) return [];
  const out: { url: string; width: number }[] = [];
  for (const W of [1024, 768]) {
    const H = Math.round((W * h) / w);
    for (const x of [H, H + 1, H - 1]) out.push({ url: `${m[1]}-${W}x${x}${m[2]}`, width: W });
  }
  return out;
}

// ── Summary ──────────────────────────────────────────────────────────

const SUMMARY_MAX = 200;

function summaryOf(block: string, title: string): string {
  let s = cleanText(firstTag(block, ['description', 'summary', 'content:encoded', 'content']));
  s = s
    .replace(/\s*The post .{0,300}? appeared first on .{0,120}$/i, '')     // WordPress footer
    .replace(/\s*\[(?:…|\.\.\.)\]/g, '…')
    .replace(/\s*(?:Continue reading|Read more|Read the full (?:story|article))\b.*$/i, '')
    .replace(/\s*(?:Find out more|Read on|Learn more|See the full)\b[^.!?]*[.!?]?$/i, '')   // teaser tail
    .replace(/^[A-Z][A-Z .,'’&]{2,40}\s+[–—]\s*/, '')                      // "WASHINGTON —" dateline
    .trim();
  if (s.toLowerCase().startsWith(title.toLowerCase())) s = s.slice(title.length).replace(/^[\s:.,–—-]+/, '');
  if (s.length < 40) return '';
  if (s.length > SUMMARY_MAX) s = s.slice(0, SUMMARY_MAX).replace(/[\s,;:–—-]+\S*$/, '') + '…';
  return s;
}

// Webinars, podcasts, ads and press releases aren't news for the shop floor.
const NOT_NEWS = /\b(webinars?|podcasts?|sponsored|advertorial|press releases?|obituar(y|ies))\b/i;

/** Stories from one feed, in feed order (newest first in practice). */
export function parseFeed(xml: string, source: string, max = 5): Headline[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out: Headline[] = [];
  for (const b of blocks) {
    const title = cleanText(firstTag(b, ['title']));
    // One- and two-word "headlines" are section pages, not stories (NASA's
    // feed sent "Software", "Instrumentation").
    if (!title || title.split(' ').length < 3 || NOT_NEWS.test(title)) continue;
    const cats = [...b.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map(m => cleanText(m[1]));
    if (cats.some(c => NOT_NEWS.test(c))) continue;
    const at = Date.parse(cleanText(firstTag(b, ['pubDate', 'dc:date', 'published', 'updated'])));
    const h: Headline = { title: title.slice(0, 220), source, at: Number.isFinite(at) ? at : 0 };
    const summary = summaryOf(b, title);
    if (summary) h.summary = summary;
    const pic = pickPicture(b);
    if (pic) {
      h.image = tvSizedPicture(pic.url);
      const width = h.image !== pic.url ? 960 : pic.width;
      if (width) h.imageWidth = width;
    }
    // RSS: <link>https://…</link>; Atom: <link rel="alternate" href="https://…"/>
    const link = cleanText(firstTag(b, ['link'])) || attr((b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>|<link\b[^>]*href=[^>]*>/i) || [''])[0], 'href');
    if (/^https:\/\/[^\s"'<>]+$/i.test(link)) h.link = link;
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Newest first across feeds, no repeated headline, nothing older than a
 * week — and no two in a row from the same source when another is waiting,
 * so the TV doesn't show five SpaceNews stories back to back.
 */
export function mergeHeadlines(lists: Headline[][], limit = 24, now = Date.now(), maxAgeDays = 7): Headline[] {
  const seen = new Set<string>();
  const fresh: Headline[] = [];
  const all = lists.flat()
    .filter(h => h.at > 0 && h.at <= now + 3_600_000 && now - h.at < maxAgeDays * 86_400_000)
    .sort((a, b) => b.at - a.at);
  for (const h of all) {
    const k = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    fresh.push(h);
  }
  const out: Headline[] = [];
  while (fresh.length && out.length < limit) {
    const prev = out.length ? out[out.length - 1].source : '';
    const i = fresh.findIndex(h => h.source !== prev);
    out.push(fresh.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}
