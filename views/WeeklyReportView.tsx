/**
 * WeeklyReportView — "the one-page owner report."
 * ─────────────────────────────────────────────────────────────────────────
 * The strategy doc asked for a single weekly page that turns everything the
 * shop's brains already compute into an at-a-glance "how are we doing." This
 * fuses them: money + week-over-week trend (shopTrends), who we depend on
 * (customerIntel concentration + going-quiet), money left on the table
 * (priceDoctor), timekeeping data health, and the open action list — then
 * synthesizes a short, honest "focus this week" list.
 *
 * Read-only and print-friendly (a real one-pager the owner can print or
 * screenshot). Every number traces to a brain already shipped, so this view
 * can never disagree with the rest of the app.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Printer, TrendingUp, TrendingDown, Minus, DollarSign, Package,
  AlertTriangle, Users as UsersIcon, Target, ClipboardCheck, Activity, ArrowRight,
} from 'lucide-react';
import type { Job, TimeLog, User, SystemSettings, ReworkEntry, ShopAction } from '../types';
import * as DB from '../services/mockDb';
import { computeShopTrends, weekStart, type TrendMetric } from '../utils/shopTrends';
import { computeCustomerIntel } from '../utils/customerIntel';
import { computePriceDoctor } from '../utils/priceDoctor';
import { computeTimekeepingHealth } from '../utils/timekeepingHealth';
import { fmtMoneyK, fmtCurrency } from '../utils/format';

const WEEK_MS = 7 * 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtRange = (startMs: number): string => {
  const s = new Date(startMs), e = new Date(startMs + 6 * 86400000);
  return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
};

/** Sparkline — pure SVG, no chart lib, prints cleanly. */
const Spark = ({ data, color = '#f59e0b' }: { data: number[]; color?: string }) => {
  if (!data.length) return null;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const rng = max - min || 1, W = 88, H = 26;
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * W},${H - ((v - min) / rng) * H}`).join(' ');
  return (
    <svg width={W} height={H} className="overflow-visible shrink-0" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      {data.length > 0 && (() => { const [x, y] = pts.split(' ').slice(-1)[0].split(','); return <circle cx={x} cy={y} r={2.5} fill={color} />; })()}
    </svg>
  );
};

const fmtMetric = (m: TrendMetric): string => {
  if (m.unit === 'money') return fmtMoneyK(m.current);
  if (m.unit === 'hours') return `${m.current.toFixed(0)}h`;
  if (m.unit === 'pct') return `${m.current.toFixed(0)}%`;
  return `${m.current.toFixed(0)}`;
};

export const WeeklyReportView = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [rework, setRework] = useState<ReworkEntry[]>([]);
  const [actions, setActions] = useState<ShopAction[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());

  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeLogs(setLogs);
    const u3 = DB.subscribeUsers(setUsers);
    const u4 = DB.subscribeSettings(setSettings);
    const u5 = DB.subscribeRework(setRework);
    const u6 = DB.subscribeShopActions(setActions);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  const now = useMemo(() => Date.now(), []);
  const trends = useMemo(() => computeShopTrends(jobs, logs, rework, now, 6), [jobs, logs, rework, now]);
  const intel = useMemo(() => computeCustomerIntel(jobs, logs, now), [jobs, logs, now]);
  const doctor = useMemo(() => computePriceDoctor(jobs, logs, settings, now, 35), [jobs, logs, settings, now]);
  const health = useMemo(
    () => computeTimekeepingHealth({ logs, jobs, users, settings, now, windowDays: 45 }),
    [logs, jobs, users, settings, now],
  );

  // Headline = most recent COMPLETE week (honest week-over-week, not a partial).
  const lastWeek = trends.weeks.length ? trends.weeks[trends.weeks.length - 1] : null;
  const goingQuiet = intel.profiles.filter(p => p.goingQuiet).slice(0, 4);
  const openActions = actions.filter(a => !a.done);
  const overdueActions = useMemo(() => {
    const tY = new Date(now); const tYmd = tY.getFullYear() * 10000 + (tY.getMonth() + 1) * 100 + tY.getDate();
    return openActions.filter(a => {
      const m = (a.dueDate || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m && (+m[3] * 10000 + +m[1] * 100 + +m[2]) < tYmd;
    }).length;
  }, [openActions, now]);
  const topUnderpriced = doctor.parts.filter(p => p.verdict === 'underpriced' || p.verdict === 'thin').slice(0, 4);

  // ── "Focus this week" — synthesize the few things that actually move money.
  const focus = useMemo(() => {
    const out: { icon: React.ReactNode; text: string; tone: 'red' | 'amber' | 'emerald' }[] = [];
    const rev = trends.metrics.find(m => m.key === 'revenue');
    if (rev && rev.deltaPct !== null && rev.deltaPct <= -10)
      out.push({ icon: <TrendingDown className="w-3.5 h-3.5" />, tone: 'red', text: `Revenue is down ${Math.abs(rev.deltaPct).toFixed(0)}% vs your recent average — line up work to refill the week.` });
    if (intel.topSharePct !== null && intel.topSharePct >= 40)
      out.push({ icon: <UsersIcon className="w-3.5 h-3.5" />, tone: intel.topSharePct >= 60 ? 'red' : 'amber', text: `${intel.topShareName} is ${intel.topSharePct.toFixed(0)}% of revenue — one customer. Pull work from a second account to de-risk.` });
    for (const p of goingQuiet)
      out.push({ icon: <TrendingDown className="w-3.5 h-3.5" />, tone: 'amber', text: `${p.name} has gone quiet (${p.daysQuiet}d). A quick check-in call often re-opens the tap.` });
    if (doctor.totalLeft90d > 500)
      out.push({ icon: <DollarSign className="w-3.5 h-3.5" />, tone: 'amber', text: `~${fmtMoneyK(doctor.totalLeft90d)} left on the table over 90 days from underpriced parts — requote the top ${Math.min(topUnderpriced.length, 3)}.` });
    if (health.criticalCount > 0)
      out.push({ icon: <AlertTriangle className="w-3.5 h-3.5" />, tone: 'red', text: `${health.criticalCount} timekeeping issue${health.criticalCount > 1 ? 's' : ''} need a look — your labor numbers depend on clean clock data.` });
    if (overdueActions > 0)
      out.push({ icon: <ClipboardCheck className="w-3.5 h-3.5" />, tone: 'red', text: `${overdueActions} action${overdueActions > 1 ? 's are' : ' is'} overdue on your list — close them or move the date.` });
    const rework = trends.metrics.find(m => m.key === 'rework');
    if (rework && rework.current > 0 && rework.deltaPct !== null && rework.deltaPct >= 25)
      out.push({ icon: <AlertTriangle className="w-3.5 h-3.5" />, tone: 'amber', text: `Rework is up ${rework.deltaPct.toFixed(0)}% — check the parts bouncing back before they eat the margin.` });
    if (out.length === 0)
      out.push({ icon: <Target className="w-3.5 h-3.5" />, tone: 'emerald', text: 'No red flags this week — revenue steady, one-customer risk in check, pricing healthy. Keep the pipeline full.' });
    return out.slice(0, 6);
  }, [trends, intel, goingQuiet, doctor, health, overdueActions, topUnderpriced]);

  const hasAny = jobs.length > 0 || logs.length > 0;

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <p className="text-[11px] font-black text-amber-500 uppercase tracking-[0.2em] mb-1">Weekly Owner Report</p>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">{settings.companyName || 'The Shop'}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {lastWeek ? `Week of ${fmtRange(lastWeek.startMs)}` : `Week of ${fmtRange(weekStart(now) - WEEK_MS)}`}
            {' · '}the numbers that matter, in one glance
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="no-print bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-200 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 active:scale-95 transition-all"
        >
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
      </div>

      {!hasAny ? (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-12 text-center">
          <Activity className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-bold">No shop activity yet.</p>
          <p className="text-zinc-600 text-sm mt-1">Complete a few jobs and log some time — this report fills in automatically.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── Focus this week — the punchline goes first ─────────────────── */}
          <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Focus this week</h2>
            </div>
            <ul className="space-y-2">
              {focus.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className={`mt-0.5 shrink-0 ${f.tone === 'red' ? 'text-red-400' : f.tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'}`}>{f.icon}</span>
                  <span className="text-zinc-200 leading-snug">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── KPI trend cards ────────────────────────────────────────────── */}
          {trends.hasData ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {['revenue', 'jobs', 'hours', 'margin'].map(k => trends.metrics.find(m => m.key === k)).filter((m): m is TrendMetric => !!m).map(m => {
                const Icon = m.direction === 'up' ? TrendingUp : m.direction === 'down' ? TrendingDown : Minus;
                const good = m.good;
                const tone = good === null ? 'text-zinc-400' : good ? 'text-emerald-400' : 'text-red-400';
                return (
                  <div key={m.key} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{m.label}</p>
                      <Spark data={m.series} color={good === false ? '#f87171' : '#f59e0b'} />
                    </div>
                    <p className="text-2xl font-black text-white tracking-tight">{fmtMetric(m)}</p>
                    <div className={`flex items-center gap-1 mt-1 text-[11px] font-bold ${tone}`}>
                      <Icon className="w-3 h-3" />
                      {m.deltaPct === null ? 'vs last week' : `${m.deltaPct > 0 ? '+' : ''}${m.deltaPct.toFixed(0)}% vs recent avg`}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 text-sm text-zinc-500">
              Trends need at least two complete weeks of activity — they’ll appear here as history builds.
            </div>
          )}

          {/* ── Two-column detail ──────────────────────────────────────────── */}
          <div className="grid lg:grid-cols-2 gap-5">
            {/* Customer concentration */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <UsersIcon className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-black text-white">Who we depend on</h3>
              </div>
              {intel.topSharePct !== null && (
                <div className={`rounded-xl px-3 py-2 mb-3 text-sm font-bold ${intel.topSharePct >= 60 ? 'bg-red-500/10 text-red-300 border border-red-500/20' : intel.topSharePct >= 40 ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'}`}>
                  {intel.topShareName} = {intel.topSharePct.toFixed(0)}% of 90-day revenue
                  <span className="font-medium opacity-80">{intel.topSharePct >= 40 ? ' — concentration risk' : ' — healthy spread'}</span>
                </div>
              )}
              <div className="space-y-1.5">
                {intel.profiles.slice(0, 5).map(p => (
                  <div key={p.key} className="flex items-center gap-2 text-sm">
                    <span className="w-28 truncate text-zinc-300 font-medium">{p.name}</span>
                    <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width: `${Math.min(100, p.sharePct)}%` }} />
                    </div>
                    <span className="w-16 text-right text-zinc-400 tabular-nums">{fmtMoneyK(p.revenue90d)}</span>
                    <span className="w-9 text-right text-zinc-600 text-xs tabular-nums">{p.sharePct.toFixed(0)}%</span>
                  </div>
                ))}
                {intel.profiles.length === 0 && <p className="text-sm text-zinc-600">No completed revenue in the last 90 days yet.</p>}
              </div>
              {goingQuiet.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <p className="text-[10px] font-black text-amber-400/80 uppercase tracking-widest mb-1.5">Gone quiet</p>
                  {goingQuiet.map(p => (
                    <p key={p.key} className="text-sm text-zinc-400">
                      <span className="text-zinc-200 font-bold">{p.name}</span> — silent {p.daysQuiet} days
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Money left on the table */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-black text-white">Money on the table</h3>
              </div>
              {doctor.hasData ? (
                <>
                  <p className="text-3xl font-black text-white tracking-tight">{fmtCurrency(doctor.totalLeft90d)}</p>
                  <p className="text-xs text-zinc-500 mb-3">underpriced parts, trailing 90 days · target {doctor.targetMarginPct}% margin</p>
                  <div className="space-y-1.5">
                    {topUnderpriced.map(p => (
                      <div key={p.partNumber} className="flex items-center gap-2 text-sm">
                        <Package className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                        <span className="flex-1 truncate text-zinc-300 font-medium">{p.partNumber}</span>
                        <span className="text-zinc-500 text-xs tabular-nums">{p.marginNowPct !== null ? `${p.marginNowPct.toFixed(0)}% now` : 'no price'}</span>
                        <ArrowRight className="w-3 h-3 text-zinc-700" />
                        <span className="text-emerald-400 text-xs font-bold tabular-nums">{fmtCurrency(p.recommendedPrice)}</span>
                      </div>
                    ))}
                    {topUnderpriced.length === 0 && <p className="text-sm text-emerald-400/80">Every part with learned cost is priced at or above target. 👍</p>}
                  </div>
                </>
              ) : (
                <p className="text-sm text-zinc-500">Set your shop rate + overhead in Settings and log a few cycles — the Price Doctor fills this in.</p>
              )}
            </div>
          </div>

          {/* ── Health + actions strip ─────────────────────────────────────── */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1"><Activity className="w-4 h-4 text-violet-400" /><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Data health</p></div>
              <p className="text-2xl font-black text-white">{health.criticalCount + health.warningCount === 0 ? 'Clean' : `${health.criticalCount + health.warningCount} to review`}</p>
              <p className="text-xs text-zinc-600">{health.criticalCount} critical · {health.warningCount} warnings · {health.checkedLogs} logs checked</p>
            </div>
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1"><ClipboardCheck className="w-4 h-4 text-violet-400" /><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Action list</p></div>
              <p className="text-2xl font-black text-white">{openActions.length} open</p>
              <p className="text-xs text-zinc-600">{overdueActions > 0 ? <span className="text-red-400 font-bold">{overdueActions} overdue</span> : 'all on schedule'}</p>
            </div>
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-violet-400" /><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">This week so far</p></div>
              <p className="text-2xl font-black text-white">{fmtMoneyK(trends.thisWeek.revenue)}</p>
              <p className="text-xs text-zinc-600">{trends.thisWeek.jobsCompleted} jobs · {trends.thisWeek.laborHours.toFixed(0)}h logged</p>
            </div>
          </div>

          <p className="text-[11px] text-zinc-600 text-center pt-1">
            Generated {new Date(now).toLocaleString()} · FabTrack IO · every figure traces to your live job &amp; time data
          </p>
        </div>
      )}
    </div>
  );
};

export default WeeklyReportView;
