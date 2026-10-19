import React, { useEffect, useMemo, useState } from 'react';
import type { Job, TeamBirthday, ShopEvent } from '../types';
import { dueNum, isJobClosed } from '../utils/dueDates';
import { getHolidays, type HolidayRecord } from '../services/holidays';
import { tvEvent } from '../utils/tvRuntime';
import { TvEmoji } from './TvSign';

// ── Aerospace News ───────────────────────────────────────────────────
// Stories from netlify/functions/news (a fixed list of public feeds), each
// with its picture and opening lines. Kept for the life of the page and
// refreshed every 20 minutes; each pass of the slide features the next
// story — big, with its photo — and lists the two or three after it.

interface NewsItem { title: string; source: string; at: number; summary?: string; image?: string }
let newsCache: { fetchedAt: number; updatedAt: number; items: NewsItem[] } | null = null;
let newsLoading: Promise<void> | null = null;

function loadNews(): Promise<void> {
  if (newsCache && Date.now() - newsCache.fetchedAt < 20 * 60_000) return Promise.resolve();
  if (newsLoading) return newsLoading;
  newsLoading = fetch('/.netlify/functions/news', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((j: any) => {
      if (j && Array.isArray(j.items)) newsCache = { fetchedAt: Date.now(), updatedAt: Number(j.updatedAt) || Date.now(), items: j.items };
      tvEvent(`news ${j && Array.isArray(j.items) ? j.items.length + ' headlines' : 'unavailable'}`);
    })
    .catch(() => { tvEvent('news failed'); /* keep showing the last headlines */ })
    .finally(() => { newsLoading = null; });
  return newsLoading;
}

const agoLabel = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return `${m || 1} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const leadIndex = (pass: number, n: number) => (n ? ((pass % n) + n) % n : 0);

// Download a picture ahead of time so it's ready the moment its slide comes
// up. (Held here so the download isn't dropped half-way.)
let warmPicture: HTMLImageElement | null = null;
function warm(src?: string) {
  if (!src || typeof Image === 'undefined' || warmPicture?.src === src) return;
  warmPicture = new Image();
  warmPicture.referrerPolicy = 'no-referrer';
  warmPicture.src = src;
}

/** Get the stories (if stale) and the photo the slide's coming pass will feature — called one slide early. */
export function prefetchNews(pass: number) {
  loadNews().then(() => {
    const items = newsCache?.items || [];
    warm(items[leadIndex(pass, items.length)]?.image);
  });
}

// When a story has no picture (or it won't load): a panel with the source's name.
const SOURCE_ICON: Record<string, string> = { Payload: '🚀', 'Breaking Defense': '🛡️', 'The Aviationist': '🛩️' };

// Longer headlines get smaller type, so every one fits in about three lines.
const leadTitleSize = (t: string) =>
  t.length <= 50 ? 'clamp(1.75rem, min(3.7vw, 6.8vh), 3.5rem)'
    : t.length <= 80 ? 'clamp(1.5rem, min(3.1vw, 5.8vh), 3rem)'
      : 'clamp(1.3rem, min(2.6vw, 4.9vh), 2.5rem)';

export const TvNewsSlide = React.memo(function TvNewsSlide({ pass }: { pass: number }) {
  const [data, setData] = useState(newsCache);
  const [tried, setTried] = useState(false);
  const [brokenPic, setBrokenPic] = useState('');
  useEffect(() => {
    let alive = true;
    loadNews().then(() => { if (alive) { setData(newsCache); setTried(true); } });
    return () => { alive = false; };
  }, []);
  const items = data?.items || [];
  const n = items.length;
  const idx = leadIndex(pass, n);
  const lead = n ? items[idx] : null;
  // Three more stories on a full-HD screen, two on a 960×540 TV stick.
  const short = typeof window !== 'undefined' && window.innerHeight < 620;
  const more: NewsItem[] = [];
  for (let k = 1; k < n && more.length < (short ? 2 : 3); k++) more.push(items[(idx + k) % n]);
  const now = Date.now();
  const pic = lead?.image && lead.image !== brokenPic ? lead.image : '';
  return (
    <div className="h-full flex flex-col overflow-hidden px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.6rem,1.4vw,1.5rem)]">
      <div className="shrink-0 flex items-center justify-between gap-3 pb-[clamp(0.4rem,1.2vh,0.9rem)]">
        <p className="flex items-center gap-2 font-black text-sky-400 uppercase tracking-[0.25em]" style={{ fontSize: 'clamp(0.8rem, min(1.25vw, 2.3vh), 1.15rem)' }}>
          <TvEmoji e="✈️" size="1.3em" /> Aerospace News
        </p>
        {data && (
          <p className="text-white/45 font-bold tabular" style={{ fontSize: 'clamp(0.7rem, min(1.05vw, 2vh), 1rem)' }}>
            {n > 1 ? `Story ${idx + 1} of ${n} · ` : ''}Updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>
      {!lead ? (
        <div className="flex-1 flex items-center justify-center text-center">
          <p className="text-white/50 font-bold" style={{ fontSize: 'clamp(1rem, 2vw, 1.6rem)' }}>
            {data ? 'No new stories right now — check back soon.' : tried ? 'The news is unavailable right now — it will be back soon.' : 'Loading the latest aerospace news…'}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-[clamp(1rem,2.5vw,2.75rem)]">
          {/* The photo — never anything drawn over it. */}
          <div className="relative min-h-0 rounded-2xl overflow-hidden border border-white/10 bg-white/[0.04]">
            {pic ? (
              <img key={pic} src={pic} alt="" referrerPolicy="no-referrer" decoding="async" draggable={false}
                onError={() => setBrokenPic(pic)} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-sky-900/50 via-slate-900/40 to-indigo-950/70">
                <TvEmoji e={SOURCE_ICON[lead.source] || '✈️'} size="clamp(3rem, min(9vw, 16vh), 8rem)" />
                <p className="font-black text-white/60 uppercase tracking-[0.2em]" style={{ fontSize: 'clamp(0.8rem, min(1.4vw, 2.6vh), 1.3rem)' }}>{lead.source}</p>
              </div>
            )}
          </div>
          <div className="min-h-0 flex flex-col overflow-hidden">
            <p className="shrink-0 flex items-center gap-2 font-bold" style={{ fontSize: 'clamp(0.75rem, min(1.2vw, 2.2vh), 1.1rem)' }}>
              <span className="text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded-md px-2 py-0.5">{lead.source}</span>
              <span className="text-white/45 tabular">{agoLabel(lead.at, now)}</span>
            </p>
            <h2 className="shrink-0 mt-[clamp(0.3rem,1vh,0.75rem)] font-black text-white leading-[1.12] line-clamp-4" style={{ fontSize: leadTitleSize(lead.title) }}>{lead.title}</h2>
            {lead.summary && (
              <p className="shrink-0 mt-[clamp(0.3rem,1.2vh,0.9rem)] text-white/70 font-medium leading-snug line-clamp-3" style={{ fontSize: 'clamp(0.95rem, min(1.7vw, 3.2vh), 1.6rem)' }}>{lead.summary}</p>
            )}
            {more.length > 0 && (
              <div className="mt-auto pt-[clamp(0.4rem,1.2vh,1rem)] min-h-0 overflow-hidden">
                <p className="font-black text-white/35 uppercase tracking-[0.25em] border-t border-white/10 pt-[clamp(0.3rem,1vh,0.7rem)]" style={{ fontSize: 'clamp(0.6rem, min(0.95vw, 1.8vh), 0.85rem)' }}>Also in the news</p>
                {more.map((h, i) => (
                  <div key={i} className="mt-[clamp(0.2rem,0.8vh,0.6rem)] flex items-baseline gap-2" style={{ fontSize: 'clamp(0.9rem, min(1.55vw, 2.9vh), 1.45rem)' }}>
                    <span className="text-sky-400 font-black shrink-0">›</span>
                    <p className={`flex-1 min-w-0 font-bold text-white/85 leading-snug ${short ? 'truncate' : 'line-clamp-2'}`}>{h.title}</p>
                    <span className="shrink-0 text-white/35 font-semibold whitespace-nowrap" style={{ fontSize: '0.75em' }}>{h.source}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ── Calendar ─────────────────────────────────────────────────────────
// This month at a glance: which jobs are due each day (open jobs, the shared
// due rule), US holidays, team birthdays and the shop's own days (closed,
// audits, visits) — plus a "due next" list readable from across the shop.

const holidayCache = new Map<number, HolidayRecord[]>();
// Ask for this year's holidays as soon as the board loads, so the calendar
// has them the first time it comes up (on the TV they filled in seconds late).
if (typeof window !== 'undefined') {
  const y = new Date().getFullYear();
  getHolidays(y).then(h => { holidayCache.set(y, h); }).catch(() => {});
}

const ymd = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const numDate = (n: number) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
const jobLabel = (j: Job) => (j.partNumber || j.jobIdsDisplay || j.poNumber || 'Job').trim();
const isUrgent = (j: Job) => j.priority === 'urgent' || j.priority === 'high';

// Sizes follow the screen's width AND height (a 960×540 TV and a 4K panel alike).
const fs = {
  tiny: 'clamp(0.62rem, min(1.15vw, 2.3vh), 1rem)',
  small: 'clamp(0.75rem, min(1.4vw, 2.7vh), 1.1rem)',
  body: 'clamp(0.95rem, min(1.8vw, 3.5vh), 1.45rem)',
  day: 'clamp(1rem, min(2.2vw, 4.2vh), 1.8rem)',
  badge: 'clamp(0.75rem, min(1.45vw, 2.8vh), 1.2rem)',
  cell: 'clamp(0.72rem, min(1.4vw, 2.7vh), 1.15rem)',
  title: 'clamp(1.2rem, min(3.2vw, 6vh), 2.6rem)',
};
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const TvCalendarSlide = React.memo(function TvCalendarSlide({ jobs, birthdays, events = [], showCustomers = true }: {
  jobs: Job[];
  birthdays: TeamBirthday[];
  events?: ShopEvent[];
  showCustomers?: boolean;
}) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const todayN = ymd(now);
  const tomorrowN = ymd(new Date(year, month, now.getDate() + 1));
  const [holidays, setHolidays] = useState<HolidayRecord[]>(() => holidayCache.get(year) || []);
  const endYear = new Date(year, month, now.getDate() + 28).getFullYear();
  useEffect(() => {
    const years = endYear === year ? [year] : [year, endYear];
    if (years.every(y => holidayCache.has(y))) { setHolidays(years.flatMap(y => holidayCache.get(y) || [])); return; }
    let alive = true;
    Promise.all(years.map(y => holidayCache.get(y) ? Promise.resolve(holidayCache.get(y)!) : getHolidays(y).then(h => { holidayCache.set(y, h); return h; })))
      .then(all => { if (alive) setHolidays(all.flat()); }).catch(() => {});
    return () => { alive = false; };
  }, [year, endYear]);

  // Open jobs with a due date, soonest first; urgent ones first within a day.
  const openDue = useMemo(() => {
    const list: { n: number; job: Job }[] = [];
    for (const j of jobs) {
      if (isJobClosed(j)) continue;
      const n = dueNum(j.dueDate);
      if (n) list.push({ n, job: j });
    }
    return list.sort((a, b) => a.n - b.n || Number(isUrgent(b.job)) - Number(isUrgent(a.job)));
  }, [jobs]);
  const dueByDay = useMemo(() => {
    const m = new Map<number, Job[]>();
    for (const { n, job } of openDue) { const a = m.get(n); if (a) a.push(job); else m.set(n, [job]); }
    return m;
  }, [openDue]);
  const overdue = useMemo(() => openDue.filter(d => d.n < todayN), [openDue, todayN]);
  // Four on short screens (a 960×540 TV), so the last one isn't clipped.
  const dueNext = useMemo(() => openDue.filter(d => d.n >= todayN).slice(0, typeof window !== 'undefined' && window.innerHeight < 700 ? 4 : 6), [openDue, todayN]);

  const holidayByDay = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of holidays) { const n = Number(h.date.replace(/-/g, '')); if (n) m.set(n, h.localName || h.name); }
    return m;
  }, [holidays]);
  const eventsByDay = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of events) {
      const n = Number((e.date || '').replace(/-/g, ''));
      if (!n || !e.label?.trim()) continue;
      const a = m.get(n); if (a) a.push(e.label.trim()); else m.set(n, [e.label.trim()]);
    }
    return m;
  }, [events]);
  const bdaysOn = (mm: number, dd: number) => birthdays.filter(b => b.month === mm && b.day === dd).map(b => b.name.trim().split(/\s+/)[0]);

  // Four weeks from this Sunday: big enough to read across the shop (a whole
  // month made every box tiny on a 32" TV), and it never runs out of days at
  // the end of a month.
  const start = new Date(year, month, now.getDate() - now.getDay());
  const days: Date[] = Array.from({ length: 28 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const last = days[27];
  const rows = 4;
  const rangeTitle = start.getMonth() === last.getMonth()
    ? `${MONTH_LONG[start.getMonth()]} ${start.getDate()} – ${last.getDate()}`
    : `${MON[start.getMonth()]} ${start.getDate()} – ${MON[last.getMonth()]} ${last.getDate()}`;

  // Coming up: shop days, birthdays and holidays in the next 30 days.
  const upcoming = useMemo(() => {
    const out: { at: Date; label: string; kind: 'event' | 'bday' | 'holiday' }[] = [];
    for (let i = 0; i <= 30; i++) {
      const d = new Date(year, month, now.getDate() + i);
      const n = ymd(d);
      for (const label of eventsByDay.get(n) || []) out.push({ at: d, label, kind: 'event' });
      for (const b of birthdays.filter(b => b.month === d.getMonth() + 1 && b.day === d.getDate())) out.push({ at: d, label: b.name, kind: 'bday' });
      const h = holidayByDay.get(n);
      if (h) out.push({ at: d, label: h, kind: 'holiday' });
    }
    return out.slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthdays, holidayByDay, eventsByDay, todayN]);

  const dayChip = (n: number) => n === todayN ? 'Today' : n === tomorrowN ? 'Tmrw'
    : (() => { const d = numDate(n); return d.getMonth() === month ? `${DOW[d.getDay()]} ${d.getDate()}` : `${MON[d.getMonth()]} ${d.getDate()}`; })();

  return (
    <div className="h-full flex overflow-hidden" style={{ gap: 'clamp(0.6rem, 1.5vw, 1.5rem)', padding: 'clamp(0.4rem, 1.6vh, 1.25rem) clamp(1rem, 2.5vw, 3rem)' }}>
      {/* The month */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 flex items-end justify-between gap-2" style={{ marginBottom: 'clamp(0.2rem, 0.8vh, 0.5rem)' }}>
          <h2 className="font-black text-white leading-none" style={{ fontSize: fs.title }}>
            {rangeTitle}
          </h2>
          <p className="font-bold text-white/45 flex items-center gap-3 whitespace-nowrap" style={{ fontSize: fs.tiny }}>
            <span><span className="text-amber-300">■</span> due</span><span className="text-red-300">■ late</span>
            <span className="text-teal-200">📌 shop</span><span>🎂</span><span className="text-sky-300">★ holiday</span>
          </p>
        </div>
        <div className="grid grid-cols-7 gap-1 shrink-0" style={{ marginBottom: '0.2rem' }}>
          {DOW.map(d => <div key={d} className="text-center font-black text-white/45 uppercase" style={{ fontSize: fs.small }}>{d}</div>)}
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {days.map((d, i) => {
            const day = d.getDate();
            const n = ymd(d);
            const dayJobs = dueByDay.get(n) || [];
            const isToday = n === todayN;
            const past = n < todayN;
            const late = past && dayJobs.length > 0;
            const soon = !past && n <= ymd(new Date(year, month, now.getDate() + 3));
            const weekend = (i % 7) === 0 || (i % 7) === 6;
            const shopDays = eventsByDay.get(n) || [];
            const holiday = holidayByDay.get(n);
            const names = bdaysOn(d.getMonth() + 1, day);
            const badge = late ? 'bg-red-600 text-white' : isToday && dayJobs.length ? 'bg-orange-500 text-black' : soon && dayJobs.length ? 'bg-amber-400 text-black' : 'bg-white/15 text-white/85';
            // Two lines fit: the shop's own days first, then holiday,
            // birthdays, then which parts are due.
            const lines: { t: string; c: string }[] = [
              ...shopDays.map(t => ({ t: `📌 ${t}`, c: 'text-teal-200' })),
              ...(holiday ? [{ t: `★ ${holiday}`, c: 'text-sky-300' }] : []),
              ...(names.length ? [{ t: `🎂 ${names.join(', ')}`, c: 'text-pink-200' }] : []),
              ...dayJobs.map(j => ({ t: jobLabel(j), c: late ? 'text-red-200' : isUrgent(j) ? 'text-amber-200' : 'text-white/65' })),
            ];
            // Stacked — day, then the due badge, then a line — because a big
            // day number and its badge side by side don't fit a TV-width box.
            const shown = lines.slice(0, dayJobs.length > 0 ? 1 : 2);
            const more = lines.length - shown.length;
            return (
              <div key={i} className={`rounded-lg border overflow-hidden flex flex-col min-w-0 ${isToday ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/60' : shopDays.length ? 'border-teal-400/40 bg-teal-500/10' : names.length ? 'border-pink-500/40 bg-pink-500/10' : weekend ? 'border-white/5 bg-zinc-900/30' : 'border-white/5 bg-zinc-900/60'}`}
                style={{ padding: 'clamp(0.15rem, 0.6vh, 0.4rem)', gap: '0.15rem' }}>
                <span className={`font-black tabular leading-none whitespace-nowrap ${isToday ? 'text-amber-300' : past ? 'text-white/35' : 'text-white/90'}`} style={{ fontSize: fs.day }}>{i === 0 || day === 1 ? `${MON[d.getMonth()]} ${day}` : day}</span>
                {dayJobs.length > 0 && <span className={`self-start whitespace-nowrap rounded px-1 font-black tabular leading-tight ${badge}`} style={{ fontSize: fs.badge }}>{dayJobs.length} due</span>}
                {shown.map((l, k) => (
                  <p key={k} className={`font-bold truncate leading-tight ${l.c} ${past && !late ? 'opacity-60' : ''}`} style={{ fontSize: fs.cell }}>
                    {l.t}{k === shown.length - 1 && more > 0 ? ` +${more}` : ''}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Due next + coming up. A div, not <aside>: TV mode hides every aside. */}
      <div className="w-[28%] max-w-sm shrink-0 flex flex-col min-w-0" style={{ gap: 'clamp(0.4rem, 1.2vh, 0.75rem)' }}>
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 min-h-0 flex flex-col overflow-hidden" style={{ padding: 'clamp(0.4rem, 1.4vh, 0.9rem)', flex: '1 1 60%' }}>
          <div className="flex items-baseline justify-between gap-2 shrink-0">
            <p className="font-black text-white/45 uppercase tracking-widest" style={{ fontSize: fs.tiny }}>Due next</p>
            {overdue.length > 0 && (
              <p className="font-black text-red-400 whitespace-nowrap" style={{ fontSize: fs.small }}>{overdue.length} overdue</p>
            )}
          </div>
          {dueNext.length === 0 ? (
            <p className="text-white/45 mt-1" style={{ fontSize: fs.small }}>Nothing else due — all caught up.</p>
          ) : (
            <ul className="mt-1 min-h-0 overflow-hidden" style={{ display: 'grid', gap: 'clamp(0.15rem, 0.7vh, 0.4rem)' }}>
              {dueNext.map(({ n, job }) => {
                const chip = n === todayN ? 'bg-orange-500 text-black' : n <= ymd(new Date(year, month, now.getDate() + 3)) ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/80';
                const sub = [showCustomers ? job.customer : '', job.quantity ? `${job.quantity} pc` : ''].filter(Boolean).join(' · ');
                return (
                  <li key={job.id} className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 rounded-md px-1.5 font-black tabular text-center ${chip}`} style={{ fontSize: fs.small, minWidth: '3.6em' }}>{dayChip(n)}</span>
                    <span className="min-w-0">
                      <span className={`block font-black truncate leading-tight ${isUrgent(job) ? 'text-amber-200' : 'text-white'}`} style={{ fontSize: fs.body }}>{jobLabel(job)}</span>
                      {sub && <span className="block text-white/45 font-bold truncate leading-tight" style={{ fontSize: fs.tiny }}>{sub}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 min-h-0 overflow-hidden" style={{ padding: 'clamp(0.4rem, 1.4vh, 0.9rem)', flex: '1 1 40%' }}>
          <p className="font-black text-white/45 uppercase tracking-widest" style={{ fontSize: fs.tiny }}>Coming up</p>
          {upcoming.length === 0 ? (
            <p className="text-white/45 mt-1" style={{ fontSize: fs.small }}>No shop days, birthdays or holidays this month.</p>
          ) : (
            <ul className="mt-1" style={{ display: 'grid', gap: 'clamp(0.15rem, 0.7vh, 0.4rem)' }}>
              {upcoming.map((u, i) => {
                const isToday = ymd(u.at) === todayN;
                const tone = u.kind === 'event' ? 'text-teal-200' : u.kind === 'bday' ? 'text-pink-200' : 'text-sky-300';
                const mark = u.kind === 'event' ? '📌' : u.kind === 'bday' ? '🎂' : '★';
                return (
                  <li key={i} className="min-w-0 flex items-baseline justify-between gap-2">
                    <span className={`font-black truncate ${tone}`} style={{ fontSize: fs.small }}>{mark} {u.label}</span>
                    <span className="shrink-0 text-white/45 font-bold" style={{ fontSize: fs.tiny }}>{isToday ? 'Today!' : `${DOW[u.at.getDay()]} ${MON[u.at.getMonth()]} ${u.at.getDate()}`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
});

// ── Happy Birthday — added to the rotation by the TV on the day ──────

export const TvBirthdaySlide = React.memo(function TvBirthdaySlide({ names }: { names: string[] }) {
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0] || '';
  return (
    <div className="h-full flex items-center justify-center p-[clamp(1rem,3vw,4rem)] text-center">
      <div className="w-full max-w-5xl rounded-[clamp(1.5rem,3vw,3rem)] border-2 border-pink-400/40 bg-gradient-to-br from-pink-500/20 via-amber-500/10 to-transparent" style={{ padding: 'clamp(1.5rem,4vw,5rem)' }}>
        <div aria-hidden="true" style={{ fontSize: 'clamp(3rem, 9vw, 8rem)' }}>🎂</div>
        <p className="font-black text-pink-300 uppercase tracking-[0.35em] mt-2" style={{ fontSize: 'clamp(0.7rem, 1.1vw, 1rem)' }}>Happy Birthday</p>
        <h2 className="font-black text-white tracking-tight leading-tight mt-2" style={{ fontSize: 'clamp(2rem, 6vw, 5rem)' }}>{list}!</h2>
        <p className="text-white/70 mt-3" style={{ fontSize: 'clamp(1rem, 1.8vw, 1.6rem)' }}>From everyone at the shop 🎉</p>
      </div>
    </div>
  );
});
