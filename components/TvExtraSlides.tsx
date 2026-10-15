import React, { useEffect, useMemo, useState } from 'react';
import type { Job, TeamBirthday } from '../types';
import { dueNum, isJobClosed } from '../utils/dueDates';
import { getHolidays, type HolidayRecord } from '../services/holidays';

// ── Aerospace News ───────────────────────────────────────────────────
// Headlines from netlify/functions/news (a fixed list of public feeds).
// Kept for the life of the page and refreshed every 20 minutes; each pass
// of the slide shows the next page of five.

interface NewsItem { title: string; source: string; at: number }
let newsCache: { fetchedAt: number; updatedAt: number; items: NewsItem[] } | null = null;
let newsLoading: Promise<void> | null = null;

function loadNews(): Promise<void> {
  if (newsCache && Date.now() - newsCache.fetchedAt < 20 * 60_000) return Promise.resolve();
  if (newsLoading) return newsLoading;
  newsLoading = fetch('/.netlify/functions/news', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then((j: any) => {
      if (j && Array.isArray(j.items)) newsCache = { fetchedAt: Date.now(), updatedAt: Number(j.updatedAt) || Date.now(), items: j.items };
    })
    .catch(() => { /* keep showing the last headlines */ })
    .finally(() => { newsLoading = null; });
  return newsLoading;
}

const agoLabel = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return `${m || 1} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export const TvNewsSlide = React.memo(function TvNewsSlide({ pass }: { pass: number }) {
  const [data, setData] = useState(newsCache);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    let alive = true;
    loadNews().then(() => { if (alive) { setData(newsCache); setTried(true); } });
    return () => { alive = false; };
  }, []);
  const PER = 5;
  const items = data?.items || [];
  const pages = Math.max(1, Math.ceil(items.length / PER));
  const page = ((pass % pages) + pages) % pages;
  const shown = items.slice(page * PER, page * PER + PER);
  const now = Date.now();
  return (
    <div className="h-full flex flex-col overflow-hidden px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.75rem,1.5vw,1.5rem)]">
      <div className="shrink-0 flex items-end justify-between gap-3 flex-wrap border-b border-white/10 pb-3">
        <div>
          <p className="font-black text-sky-400/90 uppercase tracking-[0.3em]" style={{ fontSize: 'clamp(0.625rem, 0.85vw, 0.75rem)' }}>✈ Aerospace News</p>
          <h2 className="font-black text-white" style={{ fontSize: 'clamp(1.5rem, 3.2vw, 2.6rem)' }}>What's happening in the industry</h2>
        </div>
        {data && (
          <p className="text-white/40 font-bold tabular" style={{ fontSize: 'clamp(0.7rem, 1vw, 0.95rem)' }}>
            {pages > 1 ? `Page ${page + 1} of ${pages} · ` : ''}Updated {new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center">
          <p className="text-white/50 font-bold" style={{ fontSize: 'clamp(1rem, 2vw, 1.6rem)' }}>
            {data ? 'No new headlines right now — check back soon.' : tried ? 'The news is unavailable right now — it will be back soon.' : 'Loading the latest aerospace news…'}
          </p>
        </div>
      ) : (
        <ol className="flex-1 min-h-0 flex flex-col justify-around">
          {shown.map((h, i) => (
            <li key={`${page}-${i}`} className="border-b border-white/5 last:border-b-0 py-[clamp(0.25rem,0.8vh,0.75rem)]">
              <p className="font-black text-white leading-snug line-clamp-2" style={{ fontSize: i === 0 ? 'clamp(1.2rem, 2.6vw, 2.2rem)' : 'clamp(1rem, 2vw, 1.7rem)' }}>{h.title}</p>
              <p className="mt-1 flex items-center gap-2 font-bold" style={{ fontSize: 'clamp(0.65rem, 0.95vw, 0.9rem)' }}>
                <span className="text-sky-300 bg-sky-500/10 border border-sky-500/25 rounded px-1.5 py-0.5">{h.source}</span>
                <span className="text-white/40 tabular">{agoLabel(h.at, now)}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});

// ── Calendar ─────────────────────────────────────────────────────────
// This month: jobs due each day (open jobs, the shared due rule), US
// holidays, and team birthdays, with what's coming up next.

const holidayCache = new Map<number, HolidayRecord[]>();

const ymd = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const TvCalendarSlide = React.memo(function TvCalendarSlide({ jobs, birthdays }: { jobs: Job[]; birthdays: TeamBirthday[] }) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const todayN = ymd(now);
  const [holidays, setHolidays] = useState<HolidayRecord[]>(() => holidayCache.get(year) || []);
  useEffect(() => {
    if (holidayCache.has(year)) return;
    let alive = true;
    getHolidays(year).then(h => { holidayCache.set(year, h); if (alive) setHolidays(h); }).catch(() => {});
    return () => { alive = false; };
  }, [year]);

  const dueByDay = useMemo(() => {
    const m = new Map<number, number>();
    for (const j of jobs) {
      if (isJobClosed(j)) continue;
      const n = dueNum(j.dueDate);
      if (n) m.set(n, (m.get(n) || 0) + 1);
    }
    return m;
  }, [jobs]);
  const overdueCount = useMemo(() => [...dueByDay].filter(([n]) => n < todayN).reduce((a, [, c]) => a + c, 0), [dueByDay, todayN]);

  const holidayByDay = useMemo(() => {
    const m = new Map<number, string>();
    for (const h of holidays) { const n = Number(h.date.replace(/-/g, '')); if (n) m.set(n, h.localName || h.name); }
    return m;
  }, [holidays]);

  const bdaysByDay = (mm: number, dd: number) => birthdays.filter(b => b.month === mm && b.day === dd).map(b => b.name.trim().split(/\s+/)[0]);

  const first = new Date(year, month, 1);
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const rows = cells.length / 7;

  // Coming up: birthdays and holidays in the next 30 days.
  const upcoming = useMemo(() => {
    const out: { at: Date; label: string; kind: 'bday' | 'holiday' }[] = [];
    for (let i = 0; i <= 30; i++) {
      const d = new Date(year, month, now.getDate() + i);
      for (const name of birthdays.filter(b => b.month === d.getMonth() + 1 && b.day === d.getDate()).map(b => b.name)) out.push({ at: d, label: name, kind: 'bday' });
      const h = holidayByDay.get(ymd(d));
      if (h) out.push({ at: d, label: h, kind: 'holiday' });
    }
    return out.slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthdays, holidayByDay, todayN]);
  const dueThisWeek = useMemo(() => {
    let c = 0;
    for (let i = 0; i < 7; i++) c += dueByDay.get(ymd(new Date(year, month, now.getDate() + i))) || 0;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueByDay, todayN]);

  const small = { fontSize: 'clamp(0.55rem, 0.8vw, 0.8rem)' };
  return (
    <div className="h-full flex gap-[clamp(0.75rem,1.5vw,1.5rem)] overflow-hidden px-[clamp(1rem,2.5vw,3rem)] py-[clamp(0.5rem,1.2vw,1.25rem)]">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 flex items-end justify-between gap-2 mb-2">
          <h2 className="font-black text-white" style={{ fontSize: 'clamp(1.4rem, 3vw, 2.5rem)' }}>
            {first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h2>
          <p className="font-bold text-white/40 flex items-center gap-3" style={small}>
            <span><span className="text-amber-300">■</span> jobs due</span><span>🎂 birthday</span><span className="text-sky-300">★ holiday</span>
          </p>
        </div>
        <div className="grid grid-cols-7 gap-1 shrink-0 mb-1">
          {DOW.map(d => <div key={d} className="text-center font-black text-white/40 uppercase" style={small}>{d}</div>)}
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const n = year * 10000 + (month + 1) * 100 + day;
            const due = dueByDay.get(n) || 0;
            const isToday = n === todayN;
            const late = n < todayN && due > 0;
            const soon = n >= todayN && n <= ymd(new Date(year, month, now.getDate() + 3));
            const holiday = holidayByDay.get(n);
            const names = bdaysByDay(month + 1, day);
            const tone = late ? 'bg-red-600 text-white' : isToday && due ? 'bg-orange-500 text-black' : soon && due ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/80';
            return (
              <div key={i} className={`rounded-lg border overflow-hidden p-1 flex flex-col gap-0.5 min-w-0 ${isToday ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/60' : names.length ? 'border-pink-500/40 bg-pink-500/10' : 'border-white/5 bg-zinc-900/60'}`}>
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-black tabular leading-none ${isToday ? 'text-amber-300' : 'text-white/80'}`} style={{ fontSize: 'clamp(0.75rem, 1.4vw, 1.3rem)' }}>{day}</span>
                  {due > 0 && <span className={`rounded px-1 font-black tabular leading-tight ${tone}`} style={small}>{due} due</span>}
                </div>
                {names.length > 0 && <p className="font-black text-pink-200 truncate leading-tight" style={small}>🎂 {names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}</p>}
                {holiday && <p className="font-bold text-sky-300 truncate leading-tight" style={small}>★ {holiday}</p>}
              </div>
            );
          })}
        </div>
      </div>
      {/* A div, not <aside>: TV mode hides every aside (that rule is for the app sidebar). */}
      <div className="w-[26%] max-w-xs shrink-0 flex flex-col gap-2 min-w-0">
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3">
          <p className="font-black text-white/40 uppercase tracking-widest" style={small}>Due this week</p>
          <p className="font-black text-white tabular" style={{ fontSize: 'clamp(1.5rem, 3vw, 2.6rem)' }}>{dueThisWeek} <span className="text-white/40" style={{ fontSize: 'clamp(0.75rem, 1.2vw, 1.1rem)' }}>jobs</span></p>
          {overdueCount > 0 && <p className="font-black text-red-400" style={small}>+ {overdueCount} overdue</p>}
        </div>
        <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3 flex-1 min-h-0 overflow-hidden">
          <p className="font-black text-white/40 uppercase tracking-widest mb-1.5" style={small}>Coming up</p>
          {upcoming.length === 0 ? (
            <p className="text-white/40" style={small}>No birthdays or holidays in the next month.</p>
          ) : (
            <ul className="space-y-1.5">
              {upcoming.map((u, i) => {
                const isToday = ymd(u.at) === todayN;
                return (
                  <li key={i} className="min-w-0">
                    <p className={`font-black truncate ${u.kind === 'bday' ? 'text-pink-200' : 'text-sky-300'}`} style={{ fontSize: 'clamp(0.7rem, 1.1vw, 1rem)' }}>
                      {u.kind === 'bday' ? '🎂' : '★'} {u.label}
                    </p>
                    <p className="text-white/45 font-bold" style={small}>{isToday ? 'Today!' : u.at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
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
