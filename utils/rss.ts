// Tiny RSS 2.0 / Atom headline reader — titles and dates only, no
// dependencies. Used by netlify/functions/news.ts and its tests.

export interface Headline {
  title: string;
  source: string;
  at: number;        // publish time (ms), 0 when the feed gave none
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

function cleanText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decodeEntities(s);
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

/** Headlines from one feed, in feed order (newest first in practice). */
export function parseFeed(xml: string, source: string, max = 5): Headline[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const out: Headline[] = [];
  for (const b of blocks) {
    const title = cleanText(firstTag(b, ['title']));
    if (!title) continue;
    const at = Date.parse(cleanText(firstTag(b, ['pubDate', 'dc:date', 'published', 'updated'])));
    out.push({ title: title.slice(0, 220), source, at: Number.isFinite(at) ? at : 0 });
    if (out.length >= max) break;
  }
  return out;
}

/** Newest first across feeds, no repeated headline, nothing older than a week. */
export function mergeHeadlines(lists: Headline[][], limit = 24, now = Date.now(), maxAgeDays = 7): Headline[] {
  const seen = new Set<string>();
  const out: Headline[] = [];
  const all = lists.flat()
    .filter(h => h.at > 0 && h.at <= now + 3_600_000 && now - h.at < maxAgeDays * 86_400_000)
    .sort((a, b) => b.at - a.at);
  for (const h of all) {
    const k = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
