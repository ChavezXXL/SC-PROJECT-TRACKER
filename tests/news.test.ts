import { parseFeed, mergeHeadlines, decodeEntities } from '../utils/rss';
import { SHOP_TIPS, tipForPass } from '../utils/safetyTips';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const rss = `<?xml version="1.0"?><rss><channel><title>Feed Name</title>
  <item><title><![CDATA[Boeing &amp; Airbus <b>ramp up</b> 787 output]]></title><pubDate>Thu, 15 Oct 2026 14:00:00 +0000</pubDate></item>
  <item><title>NASA&#8217;s Artemis update</title><dc:date>2026-10-15T12:00:00Z</dc:date></item>
  <item><title></title><pubDate>Thu, 15 Oct 2026 11:00:00 +0000</pubDate></item>
  <item><title>Undated story</title></item>
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

// ── Built-in safety tips ──────────────────────────────────────────
ok('40 tips', SHOP_TIPS.length === 40);
ok('every tip has an icon, title and text', SHOP_TIPS.every(t => t.icon && t.title.trim() && t.body.trim()));
const day = new Date(2026, 9, 15, 9, 0);
const seen = new Set(Array.from({ length: SHOP_TIPS.length }, (_, i) => tipForPass(i, day).title));
ok('a full day of passes goes through every tip once', seen.size === SHOP_TIPS.length);
ok('the next day starts somewhere else', tipForPass(0, day).title !== tipForPass(0, new Date(2026, 9, 16, 9, 0)).title);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
