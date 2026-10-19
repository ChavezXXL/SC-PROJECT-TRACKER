import {
  parseFeed, mergeHeadlines, decodeEntities, pickPicture, pictureSize, largerWpCopies, wpCopiesOfOriginal,
  sharePicture, tvSizedPicture, wpWidth,
} from '../utils/rss';
import { SHOP_TIPS, tipForPass } from '../utils/safetyTips';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const rss = `<?xml version="1.0"?><rss><channel><title>Feed Name</title>
  <item><title><![CDATA[Boeing &amp; Airbus <b>ramp up</b> 787 output]]></title><pubDate>Thu, 15 Oct 2026 14:00:00 +0000</pubDate></item>
  <item><title>NASA&#8217;s Artemis update</title><dc:date>2026-10-15T12:00:00Z</dc:date></item>
  <item><title></title><pubDate>Thu, 15 Oct 2026 11:00:00 +0000</pubDate></item>
  <item><title>An undated story</title></item>
</channel></rss>`;
const items = parseFeed(rss, 'Test Feed', 5);
ok('channel title is not a headline', !items.some(h => h.title === 'Feed Name'));
ok('CDATA, entities and inner tags are cleaned', items[0].title === 'Boeing & Airbus ramp up 787 output');
ok('numeric entity → curly apostrophe', items[1].title === 'NASA’s Artemis update');
ok('dc:date is read', items[1].at === Date.parse('2026-10-15T12:00:00Z'));
ok('empty titles are skipped', items.length === 3);
ok('source is attached', items.every(h => h.source === 'Test Feed'));
ok('max per feed', parseFeed(rss, 'x', 1).length === 1);

const atom = `<feed><title>Atom Feed</title>
  <entry><title type="html">SpaceX launches &amp;amp; lands</title><updated>2026-10-15T13:00:00Z</updated></entry>
</feed>`;
const a = parseFeed(atom, 'Atom', 5);
ok('atom entry read', a.length === 1 && a[0].at === Date.parse('2026-10-15T13:00:00Z'));
ok('double-encoded entity decoded', a[0].title === 'SpaceX launches & lands');
ok('decodeEntities leaves unknown names alone', decodeEntities('&bogus; &lt;') === '&bogus; <');

const now = Date.parse('2026-10-15T15:00:00Z');
const merged = mergeHeadlines([
  [{ title: 'Old news', source: 'A', at: now - 10 * 86_400_000 }, { title: 'Fresh A', source: 'A', at: now - 3_600_000 }],
  [{ title: 'Fresh B', source: 'B', at: now - 60_000 }, { title: 'fresh a', source: 'B', at: now - 7_200_000 }, { title: 'No date', source: 'B', at: 0 }],
], 10, now);
ok('newest first', merged[0].title === 'Fresh B');
ok('older than a week dropped', !merged.some(h => h.title === 'Old news'));
ok('duplicate headline (any case) dropped', merged.filter(h => h.title.toLowerCase() === 'fresh a').length === 1);
ok('undated dropped', !merged.some(h => h.title === 'No date'));
ok('limit respected', mergeHeadlines([[...Array(30)].map((_, i) => ({ title: `T${i}`, source: 's', at: now - i * 1000 }))], 5, now).length === 5);
const mixed = mergeHeadlines([
  [1, 2, 3].map(i => ({ title: `Space story ${i}`, source: 'S', at: now - i * 60_000 })),
  [{ title: 'Air story', source: 'A', at: now - 3_600_000 }],
], 10, now);
ok('no two in a row from one source when another is waiting', mixed.map(h => h.source).join('') === 'SASS');

// ── Stories: what's skipped, summaries, links ─────────────────────
const feed2 = `<rss><channel>
  <item><title>Software</title><pubDate>Thu, 15 Oct 2026 14:00:00 +0000</pubDate></item>
  <item><title>Martian Dawn</title><pubDate>Thu, 15 Oct 2026 14:00:00 +0000</pubDate></item>
  <item><title>Oct. 29: Applying AI to the mission</title><category><![CDATA[Webinar]]></category></item>
  <item><title>Startup expands to a new office</title><category>Press Release</category></item>
  <item><title>How NASA is thinking about a moon base</title><category><![CDATA[Space Minds Podcast]]></category></item>
  <item><title>Rolls-Royce kicks off Pearl 10X serial production</title>
    <link>https://www.example.com/news/pearl-10x</link>
    <description><![CDATA[<p>WASHINGTON — Propulsion specialist closing in on certification for newest member of business jet engine family.</p> The post Rolls-Royce kicks off Pearl 10X serial production appeared first on Example News.]]></description></item>
  <item><title>Delta orders 30 Boeing 787-10s</title>
    <description>Delta orders 30 Boeing 787-10s: a five-year wait raises questions about engines and capacity. Find out more here!</description></item>
  <item><title>A story with a very long opening</title><description>${'word '.repeat(80)}</description></item>
</channel></rss>`;
const s2 = parseFeed(feed2, 'Ex', 10);
ok('one- and two-word section names skipped', !s2.some(h => h.title === 'Software' || h.title === 'Martian Dawn'));
ok('webinars, press releases and podcasts skipped', s2.length === 3);
ok('WordPress footer and dateline trimmed', s2[0].summary === 'Propulsion specialist closing in on certification for newest member of business jet engine family.');
ok('story link kept', s2[0].link === 'https://www.example.com/news/pearl-10x');
ok('summary that repeats the headline, and its teaser tail, trimmed', s2[1].summary === 'a five-year wait raises questions about engines and capacity.');
ok('long summary cut at a word with …', !!s2[2].summary && s2[2].summary.length <= 201 && s2[2].summary.endsWith('…') && !s2[2].summary.includes('wor…'));
ok('Atom link read', parseFeed(`<feed><entry><title>Atom story with link</title><link rel="alternate" href="https://ex.com/a"/></entry></feed>`, 'A')[0].link === 'https://ex.com/a');

// ── Pictures ──────────────────────────────────────────────────────
ok('print-size original refused (Defense News)', pickPicture(`<item><media:thumbnail url="https://cdn.ex.com/big.jpg"/><enclosure url="https://cdn.ex.com/big.jpg" type="image/jpeg"/><media:content url="https://cdn.ex.com/big.jpg" type="image/jpeg" width="6430" height="4286"></media:content></item>`) === null);
const fromDesc = pickPicture(`<item><description><![CDATA[<figure><img width="879" height="628" src="https://i0.wp.com/ex.com/a.png?fit=879%2C628&amp;ssl=1"></figure> Text]]></description></item>`);
ok('picture in CDATA description, &amp; decoded', fromDesc?.url === 'https://i0.wp.com/ex.com/a.png?fit=879%2C628&ssl=1' && fromDesc.width === 879);
ok('entity-encoded <img> read', pickPicture(`<item><description>&lt;img src="https://ex.com/p-1024x576.jpg"&gt; Text</description></item>`)?.width === 1024);
ok('known size beats unknown', pickPicture(`<item><media:content medium="image" url="https://ex.com/full.jpg"></media:content><description><![CDATA[<img src="https://ex.com/full-460x259.jpg">]]></description></item>`)?.url === 'https://ex.com/full-460x259.jpg');
ok('non-picture enclosure ignored', pickPicture(`<item><enclosure url="https://ex.com/a.mp3" type="audio/mpeg"/></item>`) === null);
ok('icons, logos and http fixed or refused', pickPicture(`<item><description><![CDATA[<img src="https://ex.com/site-logo.png" width="300"><img src="https://ex.com/i.jpg" width="40">]]></description></item>`) === null
  && pickPicture(`<item><enclosure url="http://ex.com/p.jpg" type="image/jpeg"/></item>`)?.url === 'https://ex.com/p.jpg');
ok('article-body pictures not used', pickPicture(`<item><content:encoded><![CDATA[<img src="https://ex.com/chart.png" width="900">]]></content:encoded></item>`) === null);
ok('WordPress size read from name', wpWidth('https://ex.com/a-480x320.jpg') === 480 && wpWidth('https://ex.com/a.jpg') === 0);
const sf = parseFeed(`<rss><item><title>Delta orders more 787s</title><pubDate>Thu, 15 Oct 2026 14:00:00 +0000</pubDate><enclosure url="https://static0.simpleflyingimages.com/wp/a.png" length="1" type="image/jpeg"/></item></rss>`, 'SF')[0];
ok('resizing picture service asked for a TV-sized copy', sf.image === 'https://static0.simpleflyingimages.com/wp/a.png?q=70&fit=crop&w=960&h=540&dpr=1' && sf.imageWidth === 960);
ok('other pictures left alone', tvSizedPicture('https://ex.com/a.jpg') === 'https://ex.com/a.jpg');
const copies = largerWpCopies('https://ex.com/Falcon-480x325.jpeg').map(c => c.url);
ok('1024 copy names to try, likeliest first', copies[0] === 'https://ex.com/Falcon-1024x693.jpeg' && copies.includes('https://ex.com/Falcon-1024x694.jpeg'));
ok('then the 768 copy', copies.includes('https://ex.com/Falcon-768x520.jpeg'));
ok('no guesses from a square crop or a big copy', largerWpCopies('https://ex.com/a-200x200.jpeg').length === 0 && largerWpCopies('https://ex.com/a-1024x683.jpg').length === 0);
ok('copies of a scaled original', wpCopiesOfOriginal('https://ex.com/DSC_2980-scaled.jpeg', 2560, 1707)[0].url === 'https://ex.com/DSC_2980-1024x683.jpeg');
ok('no copies guessed without a size', wpCopiesOfOriginal('https://ex.com/a.jpeg', 0, 0).length === 0);
const og = sharePicture(`<head><meta content="https://ex.com/a.jpg" property="og:image"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675"></head>`);
ok('page share picture read (attributes either order)', og?.url === 'https://ex.com/a.jpg' && og.width === 1200 && og.height === 675);
ok('twitter picture as a fallback', sharePicture(`<meta name="twitter:image" content="https://ex.com/t.jpg">`)?.url === 'https://ex.com/t.jpg');
ok('no share picture → null', sharePicture('<head><title>x</title></head>') === null);

// Picture sizes from file headers
const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0x80, 0, 0, 0x04, 0x38]);
ok('PNG size', JSON.stringify(pictureSize(png)) === '{"w":1920,"h":1080}');
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x0a, 0xab, 0x0f, 0x00, 3, 0, 0, 0, 0, 0, 0]);
ok('JPEG size (after a JFIF block)', JSON.stringify(pictureSize(jpg)) === '{"w":3840,"h":2731}');
const webp = new Uint8Array(30); webp.set([...'RIFF'].map(c => c.charCodeAt(0)), 0); webp.set([...'WEBPVP8X'].map(c => c.charCodeAt(0)), 8);
webp.set([0xff, 0x03, 0x00, 0x37, 0x02, 0x00], 24);   // 1024 × 568
ok('WebP size', JSON.stringify(pictureSize(webp)) === '{"w":1024,"h":568}');
ok('not a picture → null', pictureSize(new TextEncoder().encode('<html>not found</html>')) === null);

// ── Built-in safety tips ──────────────────────────────────────────
ok('40 tips', SHOP_TIPS.length === 40);
ok('every tip has an icon, title and text', SHOP_TIPS.every(t => t.icon && t.title.trim() && t.body.trim()));
const day = new Date(2026, 9, 15, 9, 0);
const seen = new Set(Array.from({ length: SHOP_TIPS.length }, (_, i) => tipForPass(i, day).title));
ok('a full day of passes goes through every tip once', seen.size === SHOP_TIPS.length);
ok('the next day starts somewhere else', tipForPass(0, day).title !== tipForPass(0, new Date(2026, 9, 16, 9, 0)).title);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
