// ReportsView — worker productivity, utilization, operations breakdown,
// customer breakdown, job profitability, and estimated-vs-actual analysis.
// Extracted from App.tsx as part of the modularization effort. Pure move —
// zero functional changes.

import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Legend, Sector,
  ComposedChart, Line,
} from 'recharts';

import { Job, User, TimeLog, SystemSettings, PurchaseOrder } from '../types';
import * as DB from '../services/mockDb';
import { Avatar, useIsMobile } from '../App';
import { fmtMoneyK } from '../utils/format';
import { calcJobProfit, GRADE_COLORS, GRADE_LABELS } from '../utils/jobProfit';
import { getPartHistory } from '../utils/partHistory';

// Accurate minutes from a completed log — prefers stored durationSeconds
// (precise, from Math.floor at clock-out) over rounded durationMinutes.
// Module-level (pure) so memoized derivations don't need it as a dependency.
const logMins = (l: { durationSeconds?: number; durationMinutes?: number | null }) =>
  l.durationSeconds != null && l.durationSeconds >= 0
    ? l.durationSeconds / 60
    : (l.durationMinutes || 0);

// ── Small delta badge used on KPI cards ──────────────────────────────────────
const DeltaBadge = ({ current, prev }: { current: number; prev: number }) => {
  if (prev === 0 && current === 0) return null;
  if (prev === 0) return <span className="ml-1 text-[9px] font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">NEW</span>;
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 1) return null;
  const up = pct > 0;
  return (
    <span className={`ml-1 text-[9px] font-black px-1.5 py-0.5 rounded-full ${up ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
      {up ? '+' : ''}{pct.toFixed(0)}%
    </span>
  );
};

export const ReportsView = () => {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allPOs, setAllPOs] = useState<PurchaseOrder[]>([]);
  const [period, setPeriod] = useState<'week' | 'month' | 'custom' | 'all'>('week');
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [hoveredOpIdx, setHoveredOpIdx] = useState<number | null>(null);
  const [partQuery, setPartQuery] = useState('');
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const u1 = DB.subscribeLogs(setLogs);
    const u2 = DB.subscribeUsers(setUsers);
    const u3 = DB.subscribeJobs(setJobs);
    const u4 = DB.subscribeSettings(setSettings);
    const u5 = DB.subscribePurchaseOrders(setAllPOs);
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  const now = useMemo(() => Date.now(), []); // stable reference — avoids re-running memos every render
  const weekAgo = now - 7 * 86400000;
  const monthAgo = now - 30 * 86400000;
  const customCutoffStart = customStart ? new Date(customStart).getTime() : 0;
  // End of the custom range: INCLUSIVE end-of-day (23:59:59.999 local).
  // All period filters below use the same convention: inclusive start
  // (>= cutoff) through inclusive end (<= customCutoffEnd).
  const customCutoffEnd = customEnd ? new Date(customEnd + 'T23:59:59.999').getTime() : now;
  const cutoff = period === 'week' ? weekAgo : period === 'month' ? monthAgo : period === 'custom' ? customCutoffStart : 0;

  const completedLogs = useMemo(
    () => logs.filter(l => l.endTime && l.endTime >= cutoff && (period !== 'custom' || l.endTime <= customCutoffEnd)),
    [logs, cutoff, period, customCutoffEnd]
  );
  const activeWorkers = useMemo(() => users.filter(u => u.isActive !== false && u.role !== 'admin'), [users]);
  const shopRate = settings.shopRate || 0;
  const ohRate = (settings.monthlyOverhead || 0) / (settings.monthlyWorkHours || 160);

  // Per-worker stats
  const workerStats = useMemo(() => activeWorkers.map(w => {
    const wLogs = completedLogs.filter(l => l.userId === w.id);
    const totalMins = wLogs.reduce((a, l) => a + logMins(l), 0);
    const totalHrs = totalMins / 60;
    const jobIds = [...new Set(wLogs.map(l => l.jobId))];
    const operations = [...new Set(wLogs.map(l => l.operation))];
    const rate = (w as any).hourlyRate || shopRate;
    const cost = totalHrs * (rate + ohRate);
    const avgMinsPerSession = wLogs.length > 0 ? totalMins / wLogs.length : 0;
    return { user: w, logs: wLogs, totalMins, totalHrs, jobCount: jobIds.length, operations, cost, sessions: wLogs.length, avgMinsPerSession };
  }).sort((a, b) => b.totalHrs - a.totalHrs), [activeWorkers, completedLogs, shopRate, ohRate]);

  // Totals
  const totalHrs = workerStats.reduce((a, w) => a + w.totalHrs, 0);
  const totalCost = workerStats.reduce((a, w) => a + w.cost, 0);
  const totalSessions = workerStats.reduce((a, w) => a + w.sessions, 0);
  const completedJobs = useMemo(
    () => jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= cutoff && (period !== 'custom' || j.completedAt <= customCutoffEnd)),
    [jobs, cutoff, period, customCutoffEnd]
  );
  const totalRevenue = completedJobs.reduce((a, j) => a + (j.quoteAmount || 0), 0);

  // ── Change 1: Previous-period data for delta badges ──────────────────────
  const prevCutoff = period === 'week'
    ? weekAgo - 7 * 86400000
    : period === 'month'
    ? monthAgo - 30 * 86400000
    : cutoff;
  const showDelta = period === 'week' || period === 'month';
  const prevCompletedJobs = useMemo(() =>
    showDelta
      // Inclusive start, exclusive end at the boundary shared with the current
      // period (which starts at >= cutoff) — keeps the two windows disjoint.
      ? jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= prevCutoff && j.completedAt < cutoff)
      : [],
    [jobs, prevCutoff, cutoff, showDelta]
  );
  const prevRevenue = prevCompletedJobs.reduce((a, j) => a + (j.quoteAmount || 0), 0);
  const prevProfit = prevCompletedJobs.reduce((a, j) => a + (j.profitSnapshot?.profit ?? 0), 0);
  const currentProfit = completedJobs.reduce((a, j) => a + (j.profitSnapshot?.profit ?? 0), 0);

  // Operations breakdown
  const opBreakdown = useMemo(() => {
    const opMap = new Map<string, number>();
    completedLogs.forEach(l => opMap.set(l.operation, (opMap.get(l.operation) || 0) + logMins(l)));
    return Array.from(opMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [completedLogs]);
  const maxOpMins = opBreakdown.length > 0 ? opBreakdown[0][1] : 1;

  // ── Change 2: 12-week rolling trend data ─────────────────────────────────
  const trendWeeks = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const weekEnd = now - i * 7 * 86400000;
      const weekStart = weekEnd - 7 * 86400000;
      // Half-open interval [weekStart, weekEnd): inclusive start matches the
      // period filters above; exclusive end means a job landing exactly on a
      // week boundary is counted in exactly one week (no double-count, no gap).
      const wJobs = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= weekStart && j.completedAt < weekEnd);
      const revenue = wJobs.reduce((a, j) => a + (j.quoteAmount || 0), 0);
      const profit = wJobs.reduce((a, j) => {
        if (j.profitSnapshot) return a + j.profitSnapshot.profit;
        return a + (j.quoteAmount || 0) * 0.2; // rough estimate if no snapshot
      }, 0);
      const label = new Date(weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { label, revenue: Math.round(revenue), profit: Math.round(profit), jobs: wJobs.length };
    }).reverse();
  }, [jobs, now]);
  const trendHasData = trendWeeks.filter(w => w.jobs > 0).length >= 2;

  return (
    // Full-width — the sidebar already caps the main area. Previous
    // max-w-4xl left huge dead space on large monitors.
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Reports</h2>
          <p className="text-sm text-zinc-500">Worker productivity and shop performance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5">
            {(['week', 'month', 'all', 'custom'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors min-h-[34px] ${period === p ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                {p === 'week' ? 'Week' : p === 'month' ? 'Month' : p === 'custom' ? 'Custom' : 'All'}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex gap-2 items-center">
              <input aria-label="Custom period start date" type="date" className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-zinc-500 text-xs">to</span>
              <input aria-label="Custom period end date" type="date" className="bg-zinc-950 border border-white/10 rounded px-2 py-1 text-white text-xs" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      {(() => {
        const weeklyGoal = settings.weeklyGoalHours || 40;
        const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : period === 'custom' && customStart && customEnd ? Math.max(1, Math.ceil((customCutoffEnd - customCutoffStart) / 86400000)) : 365;
        const availableHrs = activeWorkers.length * weeklyGoal * (periodDays / 7);
        const utilization = availableHrs > 0 ? Math.min(100, (totalHrs / availableHrs) * 100) : 0;
        const profitMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;
        const avgHrsPerWorker = activeWorkers.length > 0 ? totalHrs / activeWorkers.length : 0;
        return (
          <>
            <div className="stagger grid grid-cols-2 md:grid-cols-6 gap-3">
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 text-center overflow-hidden">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Total Hours</p>
                <p className="text-xl sm:text-2xl font-black text-white tabular mt-1">{totalHrs.toFixed(1)}</p>
                <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent mt-2" aria-hidden="true" />
              </div>
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 text-center overflow-hidden">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Sessions</p>
                <p className="text-xl sm:text-2xl font-black text-white tabular mt-1">{totalSessions}</p>
                <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent mt-2" aria-hidden="true" />
              </div>
              {/* Jobs Done — with delta badge */}
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 text-center overflow-hidden">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Jobs Done</p>
                <div className="flex items-center justify-center mt-1 gap-1">
                  <p className="text-xl sm:text-2xl font-black text-emerald-400 tabular">{completedJobs.length}</p>
                  {showDelta && <DeltaBadge current={completedJobs.length} prev={prevCompletedJobs.length} />}
                </div>
                <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent mt-2" aria-hidden="true" />
              </div>
              {/* Revenue — with delta badge */}
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 text-center overflow-hidden">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Revenue</p>
                <div className="flex items-center justify-center mt-1 gap-1">
                  <p className="text-lg sm:text-2xl font-black text-emerald-400 truncate tabular">{fmtMoneyK(totalRevenue)}</p>
                  {showDelta && <DeltaBadge current={totalRevenue} prev={prevRevenue} />}
                </div>
                <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent mt-2" aria-hidden="true" />
              </div>
              <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-4 text-center overflow-hidden">
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Labor Cost</p>
                <p className="text-lg sm:text-2xl font-black text-orange-400 truncate tabular mt-1">{fmtMoneyK(Math.round(totalCost))}</p>
                <div className="h-0.5 rounded-full bg-gradient-to-r from-transparent via-orange-500/50 to-transparent mt-2" aria-hidden="true" />
              </div>
              {/* Margin — with delta badge */}
              <div className={`card-shine hover-lift-glow border rounded-2xl p-3 sm:p-4 text-center overflow-hidden ${profitMargin >= 20 ? 'bg-emerald-500/10 border-emerald-500/20' : profitMargin >= 0 ? 'bg-zinc-900/50 border-white/5' : 'bg-red-500/10 border-red-500/20'}`}>
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Margin</p>
                <div className="flex items-center justify-center mt-1 gap-1">
                  <p className={`text-xl sm:text-2xl font-black tabular ${profitMargin >= 20 ? 'text-emerald-400' : profitMargin >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{profitMargin.toFixed(0)}%</p>
                  {showDelta && <DeltaBadge current={currentProfit} prev={prevProfit} />}
                </div>
                <div className={`h-0.5 rounded-full bg-gradient-to-r from-transparent ${profitMargin >= 20 ? 'via-emerald-500/60' : profitMargin >= 0 ? 'via-yellow-500/60' : 'via-red-500/60'} to-transparent mt-2`} aria-hidden="true" />
              </div>
            </div>
            {/* Utilization Bar */}
            {(() => {
              const utilColor = utilization >= 80 ? '#10b981' : utilization >= 50 ? '#eab308' : '#ef4444';
              const utilLabel = utilization >= 80 ? 'OPTIMAL' : utilization >= 50 ? 'MODERATE' : 'UNDERUTILIZED';
              const utilTint = utilization >= 80 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : utilization >= 50 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20';
              return (
              <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-2xl p-4 sm:p-5 overflow-hidden">
                <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-white">Shop Utilization</h3>
                      <span className={`text-[9px] font-black uppercase tracking-widest border px-1.5 py-0.5 rounded ${utilTint}`}>{utilLabel}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{activeWorkers.length} worker{activeWorkers.length !== 1 ? 's' : ''} × {weeklyGoal}h goal = {availableHrs.toFixed(0)}h available</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black tabular leading-none" style={{ color: utilColor, textShadow: `0 0 20px ${utilColor}40` }}>{utilization.toFixed(0)}%</p>
                    <p className="text-[10px] text-zinc-500 mt-1">{avgHrsPerWorker.toFixed(1)}h avg/worker</p>
                  </div>
                </div>
                {/* Thick progress bar with scale ticks */}
                <div className="relative">
                  <div className="h-3 bg-zinc-800/60 rounded-full overflow-hidden relative">
                    {/* Tick marks at 25/50/75/100 */}
                    {[25, 50, 75].map(p => (
                      <div key={p} aria-hidden="true" className="absolute inset-y-0 w-[1px] bg-white/10" style={{ left: `${p}%` }} />
                    ))}
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] relative"
                      style={{
                        width: `${Math.min(100, utilization)}%`,
                        background: `linear-gradient(90deg, ${utilColor}AA, ${utilColor})`,
                        boxShadow: `0 0 12px ${utilColor}80`,
                      }}
                    />
                  </div>
                  {/* Scale labels */}
                  <div className="flex justify-between mt-1 text-[9px] font-mono text-zinc-600 tabular">
                    <span>0%</span>
                    <span>25%</span>
                    <span>50%</span>
                    <span>75%</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>
              );
            })()}

            {/* Change 5: Grade Distribution strip */}
            {(() => {
              const allDoneWithQuote = jobs.filter(j => j.status === 'completed' && j.quoteAmount);
              if (allDoneWithQuote.length === 0) return null;
              const grades = { great: 0, good: 0, tight: 0, loss: 0 };
              allDoneWithQuote.forEach(j => {
                const m = j.profitSnapshot?.marginPct ?? null;
                if (m === null) return;
                if (m >= 35) grades.great++;
                else if (m >= 15) grades.good++;
                else if (m >= 0) grades.tight++;
                else grades.loss++;
              });
              const total = grades.great + grades.good + grades.tight + grades.loss;
              if (total === 0) return null;
              const pct = (n: number) => ((n / total) * 100).toFixed(0);
              return (
                <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Job Grade Mix — All Time</h3>
                    <span className="text-[10px] text-zinc-600">{total} jobs with snapshots</span>
                  </div>
                  <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                    {grades.great > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${pct(grades.great)}%` }} title={`Great: ${grades.great}`} />}
                    {grades.good > 0 && <div className="bg-blue-500 transition-all" style={{ width: `${pct(grades.good)}%` }} title={`Good: ${grades.good}`} />}
                    {grades.tight > 0 && <div className="bg-yellow-500 transition-all" style={{ width: `${pct(grades.tight)}%` }} title={`Tight: ${grades.tight}`} />}
                    {grades.loss > 0 && <div className="bg-red-500 transition-all" style={{ width: `${pct(grades.loss)}%` }} title={`Loss: ${grades.loss}`} />}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2">
                    {(['great', 'good', 'tight', 'loss'] as const).map(g => {
                      const colors = { great: 'text-emerald-400', good: 'text-blue-400', tight: 'text-yellow-400', loss: 'text-red-400' };
                      const labels = { great: 'Great', good: 'Good', tight: 'Tight', loss: 'Loss' };
                      if (grades[g] === 0) return null;
                      return <span key={g} className={`text-[10px] font-bold ${colors[g]}`}>{labels[g]}: {grades[g]} ({pct(grades[g])}%)</span>;
                    })}
                  </div>
                </div>
              );
            })()}
          </>
        );
      })()}

      {/* Worker Productivity Table */}
      <div>
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Worker Productivity</h3>
        <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Worker</th>
                <th className="text-right p-3">Hours</th>
                <th className="text-right p-3 hidden sm:table-cell">Sessions</th>
                <th className="text-right p-3">Jobs</th>
                <th className="text-right p-3 hidden sm:table-cell">Avg/Session</th>
                <th className="text-right p-3">Cost</th>
                <th className="p-3 hidden md:table-cell">Top Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {workerStats.map(w => (
                <tr key={w.user.id} className="hover:bg-white/5">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={w.user.name} size="sm" />
                      <div>
                        <p className="text-white font-bold text-sm">{w.user.name}</p>
                        <p className="text-zinc-600 text-[10px]">{w.user.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-white font-bold">{w.totalHrs.toFixed(1)}h</td>
                  <td className="p-3 text-right font-mono text-zinc-300 hidden sm:table-cell">{w.sessions}</td>
                  <td className="p-3 text-right font-mono text-zinc-300">{w.jobCount}</td>
                  <td className="p-3 text-right font-mono text-zinc-400 hidden sm:table-cell">{w.avgMinsPerSession.toFixed(0)}m</td>
                  <td className="p-3 text-right font-mono text-orange-400">${w.cost.toFixed(0)}</td>
                  <td className="p-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {w.operations.slice(0, 3).map(op => (
                        <span key={op} className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{op}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {workerStats.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-zinc-500">No activity in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(() => {
        const VIVID = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#a855f7', '#eab308', '#64748b', '#e11d48', '#84cc16', '#0ea5e9'];
        const workerChartData = workerStats.filter(w => w.totalHrs > 0).sort((a, b) => b.totalHrs - a.totalHrs).map(w => ({ name: w.user.name.split(' ')[0], hours: parseFloat(w.totalHrs.toFixed(1)), cost: Math.round(w.cost), sessions: w.sessions }));
        const pieData = opBreakdown.map(([op, mins]) => ({ name: op, value: parseFloat((mins / 60).toFixed(1)), sessions: completedLogs.filter(l => l.operation === op).length }));
        const totalOpHrs = pieData.reduce((a, d) => a + d.value, 0);
        const totalSess = pieData.reduce((a, d) => a + d.sessions, 0);
        // Active shape for donut hover — pops slice out with outer ring, no center text (HTML overlay handles that)
        const renderActiveShape = (props: any) => {
          const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
          return (
            <g>
              <Sector cx={cx} cy={cy} innerRadius={innerRadius - 3} outerRadius={outerRadius + 8} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={1} cornerRadius={6} />
              <Sector cx={cx} cy={cy} innerRadius={outerRadius + 12} outerRadius={outerRadius + 15} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.5} />
            </g>
          );
        };
        // Active bar hover — brighter + shadow
        const renderActiveBar = (props: any) => {
          const { x, y, width, height, fill } = props;
          return <rect x={x} y={y - 2} width={width} height={height + 4} rx={10} fill={fill} opacity={1} style={{ filter: 'brightness(1.3) drop-shadow(0 0 8px rgba(255,255,255,0.15))' }} />;
        };
        // Custom bar label
        const renderBarLabel = (props: any) => {
          const { x, y, width, value, height } = props;
          if (!value) return null;
          return <text x={x + width + 8} y={y + height / 2} fill="#e4e4e7" fontSize={12} fontWeight={800} dominantBaseline="middle">{value}h</text>;
        };
        return (
          <>
          {/* Worker Hours — Full Width Bar Chart */}
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Worker Hours</h3>
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-5 overflow-hidden" style={{ boxShadow: '0 4px 30px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)' }}>
              {workerChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(isMobile ? 260 : 320, workerChartData.length * (isMobile ? 42 : 56))}>
                  <BarChart layout="vertical" data={workerChartData} margin={{ top: 5, right: isMobile ? 40 : 70, left: 0, bottom: 5 }}>
                    <defs>
                      {workerChartData.map((_, i) => (
                        <linearGradient key={`wg${i}`} id={`wGrad${i}`} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor={VIVID[i % VIVID.length]} stopOpacity={0.35} />
                          <stop offset="30%" stopColor={VIVID[i % VIVID.length]} stopOpacity={0.7} />
                          <stop offset="100%" stopColor={VIVID[i % VIVID.length]} stopOpacity={1} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis type="number" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}h`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#d4d4d8', fontSize: isMobile ? 11 : 13, fontWeight: 700 }} axisLine={false} tickLine={false} width={isMobile ? 50 : 85} />
                    <Tooltip cursor={false}
                      content={(props: any) => {
                        if (!props.active || !props.payload?.length) return null;
                        const d = props.payload[0].payload;
                        return (
                          <div style={{ background: 'rgba(9,9,11,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '16px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)' }}>
                            <p style={{ color: '#f4f4f5', fontWeight: 900, fontSize: 15, marginBottom: 8 }}>{d.name}</p>
                            <div style={{ display: 'flex', gap: 16 }}>
                              <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>HOURS</p><p style={{ color: '#f59e0b', fontSize: 18, fontWeight: 900 }}>{d.hours}h</p></div>
                              <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>SESSIONS</p><p style={{ color: '#a1a1aa', fontSize: 18, fontWeight: 900 }}>{d.sessions}</p></div>
                              {d.cost > 0 && <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>COST</p><p style={{ color: '#f59e0b', fontSize: 18, fontWeight: 900 }}>${d.cost}</p></div>}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="hours" radius={[0, 10, 10, 0]} barSize={36} isAnimationActive={true} animationDuration={800} animationEasing="ease-out" label={renderBarLabel} activeBar={renderActiveBar}>
                      {workerChartData.map((_, i) => <Cell key={i} fill={`url(#wGrad${i})`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-zinc-500 text-sm text-center py-8">No hours logged.</p>}
            </div>
          </div>

          {/* Operations Breakdown — Redesigned Donut */}
          <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-4 sm:p-6 overflow-hidden">
            <div className="flex items-start justify-between mb-4 gap-3">
              <div>
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Operations Breakdown</h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">Hours by operation · {pieData.length} type{pieData.length !== 1 ? 's' : ''}</p>
              </div>
              <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-full whitespace-nowrap">
                {totalOpHrs.toFixed(0)}h total
              </span>
            </div>

            {pieData.length > 0 ? (() => {
              const activeOp = hoveredOpIdx !== null ? pieData[hoveredOpIdx] : pieData[0];
              const activeIsLeader = hoveredOpIdx === null;
              const activePct = totalOpHrs > 0 && activeOp ? ((activeOp.value / totalOpHrs) * 100).toFixed(1) : '0';
              const activeColor = activeOp ? VIVID[pieData.indexOf(activeOp) % VIVID.length] : VIVID[0];

              return (
                <>
                {/* Donut */}
                <div className="relative grid md:grid-cols-5 gap-4 items-center" onMouseLeave={() => setHoveredOpIdx(null)}>
                  <div className="relative md:col-span-2">
                    <ResponsiveContainer width="100%" height={isMobile ? 220 : 280}>
                      <PieChart>
                        <defs>
                          {pieData.map((_, i) => {
                            const c = VIVID[i % VIVID.length];
                            return (
                              <linearGradient key={`gradOp-${i}`} id={`gradOp-${i}`} x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stopColor={c} stopOpacity={1} />
                                <stop offset="100%" stopColor={c} stopOpacity={0.6} />
                              </linearGradient>
                            );
                          })}
                        </defs>
                        <Pie
                          data={pieData}
                          cx="50%" cy="50%"
                          innerRadius={isMobile ? 62 : 80}
                          outerRadius={isMobile ? 96 : 118}
                          paddingAngle={3}
                          dataKey="value"
                          stroke="rgba(9,9,11,0.9)"
                          strokeWidth={2}
                          isAnimationActive
                          animationDuration={900}
                          animationEasing="ease-out"
                          cornerRadius={6}
                          onMouseEnter={(_, i) => setHoveredOpIdx(i)}
                        >
                          {pieData.map((_, i) => (
                            <Cell
                              key={i}
                              fill={`url(#gradOp-${i})`}
                              style={{
                                filter: hoveredOpIdx !== null && hoveredOpIdx !== i ? 'opacity(0.3)' : 'none',
                                transition: 'filter 0.25s ease',
                              }}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4">
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">
                        {activeIsLeader ? 'Top Operation' : 'Operation'}
                      </p>
                      <p className="text-[11px] font-bold truncate max-w-[160px] text-center mt-0.5" style={{ color: activeColor }}>
                        {activeOp?.name}
                      </p>
                      <p className="text-xl sm:text-2xl font-black text-white tabular mt-1 leading-none" style={{ textShadow: `0 0 24px ${activeColor}40` }}>
                        {activeOp?.value.toFixed(1)}h
                      </p>
                      <p className="text-[10px] font-mono text-zinc-500 tabular mt-1">
                        {activePct}% · {activeOp?.sessions} sess
                      </p>
                    </div>
                  </div>

                  {/* Ranked legend */}
                  <div className="md:col-span-3 space-y-1.5" onMouseLeave={() => setHoveredOpIdx(null)}>
                    {pieData.map((d, i) => {
                      const c = VIVID[i % VIVID.length];
                      const pct = totalOpHrs > 0 ? (d.value / totalOpHrs) * 100 : 0;
                      const isActive = hoveredOpIdx === i;
                      return (
                        <button
                          key={d.name}
                          type="button"
                          onMouseEnter={() => setHoveredOpIdx(i)}
                          onFocus={() => setHoveredOpIdx(i)}
                          onBlur={() => setHoveredOpIdx(null)}
                          aria-label={`${d.name}: ${d.value.toFixed(1)}h, ${pct.toFixed(0)}% share`}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${isActive ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                        >
                          <span className="w-4 text-center text-[10px] font-black text-zinc-600 tabular shrink-0">{i+1}</span>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c, boxShadow: isActive ? `0 0 10px ${c}` : `0 0 4px ${c}80` }} />
                          <span className={`flex-1 text-xs font-semibold truncate text-left transition-colors ${isActive ? 'text-white' : 'text-zinc-300'}`}>{d.name}</span>
                          <div className="relative w-12 sm:w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                            <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${pct}%`, background: c, boxShadow: `0 0 6px ${c}80` }} />
                          </div>
                          <span className="text-[11px] font-mono font-bold text-zinc-200 tabular text-right shrink-0 w-12">{d.value.toFixed(1)}h</span>
                          <span className="text-[10px] font-mono text-zinc-500 tabular text-right shrink-0 w-8">{pct.toFixed(0)}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer summary */}
                <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Total Hours</p>
                    <p className="text-sm font-black text-white tabular mt-0.5">{totalOpHrs.toFixed(0)}h</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Sessions</p>
                    <p className="text-sm font-black text-amber-400 tabular mt-0.5">{totalSess}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Operations</p>
                    <p className="text-sm font-black text-purple-400 tabular mt-0.5">{pieData.length}</p>
                  </div>
                </div>
                </>
              );
            })() : (
              <div className="py-12 text-center">
                <p className="text-zinc-500 text-sm">No operation data for this period.</p>
              </div>
            )}
          </div>
          </>
        );
      })()}

      {/* Change 2: Revenue & Profit Trend — Last 12 Weeks */}
      {trendHasData && (
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Revenue &amp; Profit Trend — Last 12 Weeks</h3>
          <p className="text-[10px] text-zinc-600 mb-3">Always shows all-time 12-week rolling window, independent of period filter</p>
          <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-5 overflow-hidden">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trendWeeks} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="trendRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="trendProfGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} interval={isMobile ? 2 : 1} />
                <YAxis tick={{ fill: '#52525b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  content={(props: any) => {
                    if (!props.active || !props.payload?.length) return null;
                    const d = props.payload[0]?.payload;
                    const rev = d?.revenue ?? 0;
                    const prof = d?.profit ?? 0;
                    const margin = rev > 0 ? ((prof / rev) * 100).toFixed(0) : '—';
                    return (
                      <div style={{ background: 'rgba(9,9,11,0.97)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 18px', boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
                        <p style={{ color: '#f4f4f5', fontWeight: 900, fontSize: 13, marginBottom: 8 }}>Week of {d?.label}</p>
                        <div style={{ display: 'flex', gap: 16 }}>
                          <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>REVENUE</p><p style={{ color: '#10b981', fontSize: 16, fontWeight: 900 }}>${rev.toLocaleString()}</p></div>
                          <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>PROFIT</p><p style={{ color: '#f59e0b', fontSize: 16, fontWeight: 900 }}>${prof.toLocaleString()}</p></div>
                          <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>MARGIN</p><p style={{ color: '#a78bfa', fontSize: 16, fontWeight: 900 }}>{margin}%</p></div>
                          <div><p style={{ color: '#71717a', fontSize: 10, fontWeight: 600, letterSpacing: 1, marginBottom: 2 }}>JOBS</p><p style={{ color: '#e4e4e7', fontSize: 16, fontWeight: 900 }}>{d?.jobs}</p></div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend formatter={(v: string) => <span style={{ color: '#d4d4d8', fontSize: 11, fontWeight: 600 }}>{v === 'revenue' ? 'Revenue' : 'Profit'}</span>} />
                <Bar dataKey="revenue" fill="url(#trendRevGrad)" radius={[6, 6, 0, 0]} barSize={isMobile ? 10 : 16} name="revenue" isAnimationActive animationDuration={700} />
                <Bar dataKey="profit" fill="url(#trendProfGrad)" radius={[6, 6, 0, 0]} barSize={isMobile ? 10 : 16} name="profit" isAnimationActive animationDuration={700} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Change 3: Customer Breakdown — upgraded with profit margin */}
      {(() => {
        const custMap = new Map<string, { jobs: number; hours: number; revenue: number; cost: number; profit: number }>();
        completedLogs.forEach(l => {
          const j = jobs.find(jj => jj.id === l.jobId);
          const cust = j?.customer || 'Unknown';
          const cur = custMap.get(cust) || { jobs: 0, hours: 0, revenue: 0, cost: 0, profit: 0 };
          cur.hours += logMins(l) / 60;
          custMap.set(cust, cur);
        });
        jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= cutoff && (period !== 'custom' || j.completedAt <= customCutoffEnd)).forEach(j => {
          const cust = j.customer || 'Unknown';
          const cur = custMap.get(cust) || { jobs: 0, hours: 0, revenue: 0, cost: 0, profit: 0 };
          cur.jobs++;
          cur.revenue += j.quoteAmount || 0;
          cur.profit += j.profitSnapshot?.profit ?? 0;
          custMap.set(cust, cur);
        });
        // Sort by revenue descending
        const custBreakdown = Array.from(custMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue);
        if (custBreakdown.length === 0) return null;
        const maxHours = custBreakdown.reduce((m, [, d]) => Math.max(m, d.hours), 0) || 1;
        const maxRevenue = custBreakdown.reduce((m, [, d]) => Math.max(m, d.revenue), 0) || 1;
        const totalRevenueC = custBreakdown.reduce((a, [, d]) => a + d.revenue, 0);
        const totalHoursC = custBreakdown.reduce((a, [, d]) => a + d.hours, 0);
        const totalJobsC = custBreakdown.reduce((a, [, d]) => a + d.jobs, 0);
        return (
          <div className="card-shine hover-lift-glow bg-gradient-to-br from-zinc-900/60 to-zinc-900/30 border border-white/5 rounded-3xl p-4 sm:p-6 overflow-hidden">
            <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest">Customer Breakdown</h3>
                <p className="text-[11px] text-zinc-600 mt-0.5">{custBreakdown.length} customer{custBreakdown.length !== 1 ? 's' : ''} · sorted by revenue</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-full whitespace-nowrap">{totalHoursC.toFixed(0)}h</span>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full whitespace-nowrap">{fmtMoneyK(totalRevenueC)}</span>
              </div>
            </div>

            {/* Column headers */}
            <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 px-2 pb-2 border-b border-white/5">
              <span className="w-4 text-[9px] font-black text-zinc-600 uppercase tracking-widest">#</span>
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Customer</span>
              <span className="w-16 text-right text-[9px] font-black text-zinc-600 uppercase tracking-widest">Jobs</span>
              <span className="w-32 text-[9px] font-black text-zinc-600 uppercase tracking-widest">Hours</span>
              <span className="w-32 text-[9px] font-black text-zinc-600 uppercase tracking-widest">Revenue</span>
              <span className="w-16 text-right text-[9px] font-black text-zinc-600 uppercase tracking-widest">Margin</span>
            </div>

            <div className="mt-2 space-y-0.5">
              {custBreakdown.map(([cust, data], i) => {
                const hrPct = (data.hours / maxHours) * 100;
                const revPct = maxRevenue > 0 ? (data.revenue / maxRevenue) * 100 : 0;
                const marginPct = data.revenue > 0 ? (data.profit / data.revenue) * 100 : null;
                const marginColor = marginPct === null ? 'text-zinc-600' : marginPct >= 35 ? 'text-emerald-400' : marginPct >= 15 ? 'text-blue-400' : marginPct >= 0 ? 'text-yellow-400' : 'text-red-400';
                return (
                  <div key={cust} className="grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] grid-cols-[auto_1fr_auto] items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                    <span className="w-4 text-center text-[10px] font-black text-zinc-600 tabular">{i+1}</span>
                    <span className="text-sm font-semibold text-zinc-200 truncate">{cust}</span>
                    <span className="w-16 text-right font-mono text-[11px] text-zinc-400 tabular hidden sm:inline">{data.jobs}</span>
                    {/* Hours bar */}
                    <div className="flex items-center gap-2 w-32 sm:w-32">
                      <div className="relative flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${hrPct}%`, background: 'linear-gradient(90deg, #f59e0b, #f59e0bCC)', boxShadow: '0 0 6px rgba(245,158,11,0.5)' }} />
                      </div>
                      <span className="text-[11px] font-mono font-bold text-zinc-200 tabular w-12 text-right">{data.hours.toFixed(1)}h</span>
                    </div>
                    {/* Revenue bar — only on sm+ */}
                    <div className="hidden sm:flex items-center gap-2 w-32">
                      <div className="relative flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                        {data.revenue > 0 && (
                          <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${revPct}%`, background: 'linear-gradient(90deg, #10b981, #10b981CC)', boxShadow: '0 0 6px rgba(16,185,129,0.5)' }} />
                        )}
                      </div>
                      <span className={`text-[11px] font-mono font-bold tabular w-14 text-right ${data.revenue > 0 ? 'text-emerald-400' : 'text-zinc-700'}`}>
                        {data.revenue > 0 ? fmtMoneyK(data.revenue) : '—'}
                      </span>
                    </div>
                    {/* Margin column — only on sm+ */}
                    <span className={`hidden sm:inline w-16 text-right font-mono text-[11px] font-bold tabular ${marginColor}`}>
                      {marginPct !== null && data.profit !== 0 ? `${marginPct.toFixed(0)}%` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Footer totals */}
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Customers</p>
                <p className="text-sm font-black text-white tabular mt-0.5">{custBreakdown.length}</p>
              </div>
              <div>
                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Jobs</p>
                <p className="text-sm font-black text-amber-400 tabular mt-0.5">{totalJobsC}</p>
              </div>
              <div>
                <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Revenue</p>
                <p className="text-sm font-black text-emerald-400 tabular mt-0.5">{fmtMoneyK(totalRevenueC)}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Change 4: Part Number Intelligence */}
      {(() => {
        const partMap = new Map<string, { runs: number; totalHrs: number; totalRevenue: number; totalProfit: number; margins: number[] }>();
        jobs.filter(j => j.status === 'completed' && j.partNumber && j.quoteAmount).forEach(j => {
          const pn = j.partNumber!;
          const cur = partMap.get(pn) || { runs: 0, totalHrs: 0, totalRevenue: 0, totalProfit: 0, margins: [] };
          cur.runs++;
          cur.totalRevenue += j.quoteAmount || 0;
          if (j.profitSnapshot) {
            cur.totalProfit += j.profitSnapshot.profit;
            cur.totalHrs += j.profitSnapshot.laborHours;
            cur.margins.push(j.profitSnapshot.marginPct);
          }
          partMap.set(pn, cur);
        });
        const parts = Array.from(partMap.entries())
          .filter(([, d]) => d.runs >= 1)
          .map(([pn, d]) => ({
            pn,
            runs: d.runs,
            avgHrs: d.totalHrs > 0 ? d.totalHrs / d.runs : 0,
            avgRevenue: d.totalRevenue / d.runs,
            avgMargin: d.margins.length > 0 ? d.margins.reduce((a, b) => a + b, 0) / d.margins.length : 0,
            totalRevenue: d.totalRevenue,
          }))
          .sort((a, b) => b.totalRevenue - a.totalRevenue)
          .slice(0, 10);
        if (parts.length < 2) return null;
        return (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Part Number Intelligence</h3>
            <p className="text-[10px] text-zinc-600 mb-3">All-time · helps you quote faster and spot your most profitable work</p>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
                  <tr>
                    <th className="text-left p-2 sm:p-3">Part #</th>
                    <th className="text-right p-2 sm:p-3">Runs</th>
                    <th className="text-right p-2 sm:p-3 hidden sm:table-cell">Avg Hrs</th>
                    <th className="text-right p-2 sm:p-3">Avg Revenue</th>
                    <th className="text-right p-2 sm:p-3">Avg Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {parts.map(p => {
                    const marginColor = p.avgMargin >= 35 ? 'text-emerald-400' : p.avgMargin >= 15 ? 'text-blue-400' : p.avgMargin >= 0 ? 'text-yellow-400' : 'text-red-400';
                    return (
                      <tr key={p.pn} className="hover:bg-white/5">
                        <td className="p-2 sm:p-3 font-mono font-bold text-white text-xs sm:text-sm">{p.pn}</td>
                        <td className="p-2 sm:p-3 text-right font-mono text-zinc-400">{p.runs}×</td>
                        <td className="p-2 sm:p-3 text-right font-mono text-zinc-400 hidden sm:table-cell">{p.avgHrs > 0 ? p.avgHrs.toFixed(1) + 'h' : '—'}</td>
                        <td className="p-2 sm:p-3 text-right font-mono text-zinc-200">${p.avgRevenue.toFixed(0)}</td>
                        <td className={`p-2 sm:p-3 text-right font-mono font-bold ${marginColor}`}>{p.avgMargin > 0 ? p.avgMargin.toFixed(0) + '%' : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Part History Lookup — search any part, see every past run + who ran it ── */}
      {(() => {
        // Distinct completed part numbers, most-run first (for the suggestion list)
        const partCounts = new Map<string, number>();
        jobs.forEach(j => {
          if (j.status === 'completed' && j.partNumber?.trim()) {
            const k = j.partNumber.trim();
            partCounts.set(k, (partCounts.get(k) || 0) + 1);
          }
        });
        const allParts = Array.from(partCounts.entries())
          .map(([pn, runs]) => ({ pn, runs }))
          .sort((a, b) => b.runs - a.runs);
        if (allParts.length === 0) return null;

        const q = partQuery.trim().toLowerCase();
        const matches = q
          ? allParts.filter(p => p.pn.toLowerCase().includes(q)).slice(0, 8)
          : allParts.slice(0, 8); // show busiest parts before any typing

        const hist = selectedPart ? getPartHistory(selectedPart, jobs, logs) : null;

        const fmtDate = (ms?: number) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

        return (
          <div>
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Part History Lookup</h3>
            <p className="text-[10px] text-zinc-600 mb-3">Search any part you've run before — see every past run, how long it took, and who ran it.</p>

            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 sm:p-5 space-y-4">
              {/* Search box */}
              <div className="relative">
                <input
                  type="text"
                  value={partQuery}
                  onChange={e => setPartQuery(e.target.value)}
                  placeholder={`Search part # (${allParts.length} parts on record)`}
                  aria-label="Search part number"
                  className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
                />
              </div>

              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-1.5">
                {matches.map(p => (
                  <button
                    key={p.pn}
                    type="button"
                    onClick={() => { setSelectedPart(p.pn); }}
                    className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border transition-colors ${selectedPart === p.pn ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'}`}
                  >
                    {p.pn} <span className="text-zinc-500 font-normal">· {p.runs}×</span>
                  </button>
                ))}
                {matches.length === 0 && <span className="text-xs text-zinc-600 py-1">No matching part on record.</span>}
              </div>

              {/* Selected part history */}
              {hist && (
                <div className="border-t border-white/5 pt-4 space-y-4">
                  {/* KPI strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="bg-zinc-950/60 rounded-xl p-3 text-center">
                      <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Runs</p>
                      <p className="text-lg font-black text-white tabular mt-0.5">{hist.totalRuns}</p>
                    </div>
                    <div className="bg-zinc-950/60 rounded-xl p-3 text-center">
                      <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Avg / Job</p>
                      <p className="text-lg font-black text-amber-400 tabular mt-0.5">{hist.avgJobHours.toFixed(1)}h</p>
                    </div>
                    <div className="bg-zinc-950/60 rounded-xl p-3 text-center">
                      <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Hrs / Unit</p>
                      <p className="text-lg font-black text-blue-400 tabular mt-0.5">{hist.avgHoursPerUnit.toFixed(2)}</p>
                    </div>
                    <div className="bg-zinc-950/60 rounded-xl p-3 text-center">
                      <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">On-Time</p>
                      <p className={`text-lg font-black tabular mt-0.5 ${hist.onTimeRate >= 80 ? 'text-emerald-400' : hist.onTimeRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{hist.onTimeRate}%</p>
                    </div>
                    <div className="bg-zinc-950/60 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
                      <p className="text-[9px] text-zinc-500 uppercase font-black tracking-widest">Fastest</p>
                      <p className="text-xs font-bold text-emerald-300 truncate mt-1" title={hist.bestWorker ? `${hist.bestWorker.name} · ${hist.bestWorker.avgHoursPerUnit.toFixed(2)} h/unit` : ''}>
                        {hist.bestWorker ? hist.bestWorker.name : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Per-run table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-zinc-950/50 text-zinc-500 text-[10px] uppercase">
                        <tr>
                          <th className="text-left p-2">Completed</th>
                          <th className="text-left p-2">PO</th>
                          <th className="text-right p-2">Qty</th>
                          <th className="text-left p-2">Ran By</th>
                          <th className="text-right p-2">Hours</th>
                          <th className="text-right p-2 hidden sm:table-cell">Hrs/Unit</th>
                          <th className="text-center p-2">On-Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {hist.runs.map(r => (
                          <tr key={r.jobId} className="hover:bg-white/5">
                            <td className="p-2 text-zinc-400 text-xs font-mono">{fmtDate(r.completedAt)}</td>
                            <td className="p-2 text-white font-bold text-xs">{r.poNumber}</td>
                            <td className="p-2 text-right font-mono text-zinc-400">{r.quantity}</td>
                            <td className="p-2 text-zinc-300 text-xs">{r.primaryWorker || '—'}</td>
                            <td className="p-2 text-right font-mono text-amber-400 font-bold">{r.totalHours.toFixed(1)}h</td>
                            <td className="p-2 text-right font-mono text-blue-400 hidden sm:table-cell">{r.hoursPerUnit > 0 ? r.hoursPerUnit.toFixed(2) : '—'}</td>
                            <td className="p-2 text-center">
                              {r.onTime
                                ? <span className="text-[10px] font-black text-emerald-400">ON TIME</span>
                                : <span className="text-[10px] font-black text-red-400">LATE</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedPart && !hist && (
                <p className="text-xs text-zinc-500 border-t border-white/5 pt-4">No completed runs found for that part yet.</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Job Profitability — uses locked profitSnapshot when available for accuracy */}
      {(() => {
        const profitableJobs = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= cutoff && (period !== 'custom' || j.completedAt <= customCutoffEnd) && j.quoteAmount).map(j => {
          // Prefer locked snapshot (fully accurate: labor + materials + outsourced)
          // Fall back to calcJobProfit (live calculation using same engine)
          const snap = j.profitSnapshot;
          if (snap) {
            const grade = snap.marginPct >= 35 ? 'great' : snap.marginPct >= 15 ? 'good' : snap.marginPct >= 0 ? 'tight' : 'loss';
            return { ...j, hrs: snap.laborHours, cost: snap.totalCost, profit: snap.profit, margin: snap.marginPct, revenuePerHour: snap.laborHours > 0 ? snap.revenue / snap.laborHours : 0, grade, isSnapshot: true };
          }
          const breakdown = calcJobProfit(j, logs, users, settings, allPOs);
          return { ...j, hrs: breakdown.laborHours, cost: breakdown.totalCost, profit: breakdown.profit, margin: breakdown.marginPct, revenuePerHour: breakdown.revenuePerHour, grade: breakdown.grade, isSnapshot: false };
        }).sort((a, b) => b.profit - a.profit);
        if (profitableJobs.length === 0) return null;
        const maxMargin = profitableJobs.reduce((m, j) => Math.max(m, Math.abs(j.margin)), 0) || 100;
        const totalProfitSum = profitableJobs.reduce((a, j) => a + j.profit, 0);
        const avgMargin = profitableJobs.reduce((a, j) => a + j.margin, 0) / profitableJobs.length;
        const snapCount = profitableJobs.filter(j => j.isSnapshot).length;
        return (
          <div>
            <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
              <div>
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Job Profitability</h3>
                {snapCount > 0 && (
                  <p className="text-[9px] text-zinc-600 mt-0.5">{snapCount}/{profitableJobs.length} locked · includes labor + materials + outsourcing</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${totalProfitSum >= 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                  {totalProfitSum >= 0 ? '+' : ''}${totalProfitSum.toFixed(0)} net
                </span>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${avgMargin >= 20 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : avgMargin >= 0 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                  {avgMargin.toFixed(0)}% avg margin
                </span>
              </div>
            </div>
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
                  <tr>
                    <th className="text-left p-2 sm:p-3">PO / Part</th>
                    <th className="text-right p-2 sm:p-3 hidden md:table-cell">Revenue</th>
                    <th className="text-right p-2 sm:p-3 hidden sm:table-cell">Total Cost</th>
                    <th className="text-right p-2 sm:p-3">Profit</th>
                    <th className="p-2 sm:p-3">Margin</th>
                    <th className="text-right p-2 sm:p-3 hidden lg:table-cell">$/hr</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {profitableJobs.map(j => {
                    const colors = GRADE_COLORS[j.grade as keyof typeof GRADE_COLORS];
                    const barWidth = Math.min(100, (Math.abs(j.margin) / maxMargin) * 100);
                    const marginHex = j.grade === 'great' ? '#10b981' : j.grade === 'good' ? '#3b82f6' : j.grade === 'tight' ? '#eab308' : '#ef4444';
                    return (
                    <tr key={j.id} className="hover:bg-white/5">
                      <td className="p-2 sm:p-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-white font-bold text-xs sm:text-sm">{j.poNumber}</span>
                          <span className="text-zinc-500 text-[10px] sm:text-xs truncate max-w-[140px] sm:max-w-none">{j.partNumber}</span>
                          <span className={`text-[9px] font-black ${colors.text}`}>{GRADE_LABELS[j.grade as keyof typeof GRADE_LABELS]}{j.isSnapshot ? ' 🔒' : ' ~'}</span>
                        </div>
                      </td>
                      <td className="p-2 sm:p-3 text-right font-mono text-zinc-300 text-xs sm:text-sm hidden md:table-cell">${(j.quoteAmount || 0).toLocaleString()}</td>
                      <td className="p-2 sm:p-3 text-right font-mono text-orange-400 text-xs sm:text-sm hidden sm:table-cell">${j.cost.toFixed(0)}</td>
                      <td className={`p-2 sm:p-3 text-right font-mono font-bold text-xs sm:text-sm ${j.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{j.profit >= 0 ? '+' : ''}${j.profit.toFixed(0)}</td>
                      <td className="p-2 sm:p-3">
                        <div className="flex items-center gap-2">
                          <div className="relative w-14 sm:w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                              style={{ width: `${barWidth}%`, background: marginHex, boxShadow: `0 0 6px ${marginHex}80` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] sm:text-xs font-bold tabular" style={{ color: marginHex }}>{j.margin.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="p-2 sm:p-3 text-right font-mono text-[11px] text-amber-400 hidden lg:table-cell">
                        {j.revenuePerHour > 0 ? `$${j.revenuePerHour.toFixed(0)}/h` : '—'}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Estimated vs Actual ── */}
      {(() => {
        const quotedJobs = jobs.filter(j => j.status === 'completed' && j.completedAt && j.completedAt >= cutoff && (period !== 'custom' || j.completedAt <= customCutoffEnd) && (j.quoteAmount || j.expectedHours)).map(j => {
          const jLogs = completedLogs.filter(l => l.jobId === j.id);
          const actualHrs = jLogs.reduce((a, l) => a + logMins(l), 0) / 60;
          const actualCost = actualHrs * ((shopRate || 0) + ohRate);
          const estHrs = j.expectedHours || 0;
          const quotedAmt = j.quoteAmount || 0;
          const hrsVariance = estHrs > 0 ? ((actualHrs - estHrs) / estHrs * 100) : 0;
          const costVariance = quotedAmt > 0 ? ((quotedAmt - actualCost) / quotedAmt * 100) : 0;
          return { ...j, actualHrs, actualCost, estHrs, quotedAmt, hrsVariance, costVariance };
        });
        if (quotedJobs.length === 0) return null;
        const avgAccuracy = quotedJobs.filter(j => j.estHrs > 0).length > 0
          ? quotedJobs.filter(j => j.estHrs > 0).reduce((a, j) => a + Math.max(0, 100 - Math.abs(j.hrsVariance)), 0) / quotedJobs.filter(j => j.estHrs > 0).length
          : 0;
        const totalProfit = quotedJobs.reduce((a, j) => a + (j.quotedAmt - j.actualCost), 0);
        const bestJob = [...quotedJobs].sort((a, b) => b.costVariance - a.costVariance)[0];
        const worstJob = [...quotedJobs].sort((a, b) => a.costVariance - b.costVariance)[0];
        const barData = quotedJobs.slice(0, 10).map(j => ({
          name: j.poNumber.length > 10 ? j.poNumber.slice(0, 9) + '…' : j.poNumber,
          estimated: parseFloat(j.estHrs.toFixed(1)),
          actual: parseFloat(j.actualHrs.toFixed(1)),
        }));
        return (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Estimated vs Actual</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Est. Accuracy</p>
                <p className={`text-xl font-black ${avgAccuracy >= 80 ? 'text-emerald-400' : avgAccuracy >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>{avgAccuracy.toFixed(0)}%</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Net Profit</p>
                <p className={`text-xl font-black ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(0)}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Best Job</p>
                <p className="text-sm font-bold text-emerald-400 truncate">{bestJob?.poNumber}</p>
                <p className="text-[10px] text-zinc-600">{bestJob ? `+${bestJob.costVariance.toFixed(0)}%` : '-'}</p>
              </div>
              <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3 text-center">
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Worst Job</p>
                <p className="text-sm font-bold text-red-400 truncate">{worstJob?.poNumber}</p>
                <p className="text-[10px] text-zinc-600">{worstJob ? `${worstJob.costVariance.toFixed(0)}%` : '-'}</p>
              </div>
            </div>
            {barData.some(d => d.estimated > 0) && (
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-5" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}>
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-3">Hours: Estimated vs Actual</p>
                <ResponsiveContainer width="100%" height={isMobile ? 240 : 320}>
                  <BarChart data={barData} margin={{ top: 10, right: 10, left: 0, bottom: isMobile ? 45 : 35 }}>
                    <defs>
                      <linearGradient id="estGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#93c5fd" /><stop offset="50%" stopColor="#60a5fa" /><stop offset="100%" stopColor="#3b82f6" /></linearGradient>
                      <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fde68a" /><stop offset="50%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#f59e0b" /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={55} />
                    <YAxis tick={{ fill: '#52525b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}h`} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                      content={(props: any) => {
                        if (!props.active || !props.payload?.length) return null;
                        const d = props.payload;
                        const est = d.find((e: any) => e.dataKey === 'estimated')?.value || 0;
                        const act = d.find((e: any) => e.dataKey === 'actual')?.value || 0;
                        const diff = act - est;
                        return (
                          <div style={{ background: 'rgba(9,9,11,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 18px', boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
                            <p style={{ color: '#f4f4f5', fontWeight: 900, fontSize: 14, marginBottom: 8 }}>{props.label}</p>
                            <p style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 3 }}>Estimated: <span style={{ color: '#60a5fa', fontWeight: 800 }}>{est}h</span></p>
                            <p style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 3 }}>Actual: <span style={{ color: '#fbbf24', fontWeight: 800 }}>{act}h</span></p>
                            {est > 0 && <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6, marginTop: 6 }}>
                              <p style={{ color: diff > 0 ? '#ef4444' : '#10b981', fontSize: 12, fontWeight: 700 }}>
                                {diff > 0 ? 'Over by' : 'Under by'} {Math.abs(diff).toFixed(1)}h ({est > 0 ? Math.abs(diff / est * 100).toFixed(0) : 0}%)
                              </p>
                            </div>}
                          </div>
                        );
                      }}
                    />
                    <Legend formatter={(v: string) => <span style={{ color: '#d4d4d8', fontSize: 12, fontWeight: 600 }}>{v === 'estimated' ? 'Estimated' : 'Actual'}</span>} />
                    <Bar dataKey="estimated" fill="url(#estGrad)" radius={[8, 8, 0, 0]} barSize={22} name="estimated" isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                    <Bar dataKey="actual" fill="url(#actGrad)" radius={[8, 8, 0, 0]} barSize={22} name="actual" isAnimationActive={true} animationDuration={800} animationEasing="ease-out" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-950/50 text-zinc-500 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">PO</th>
                    <th className="text-right p-3">Quoted</th>
                    <th className="text-right p-3">Actual Cost</th>
                    <th className="text-right p-3">Est. Hrs</th>
                    <th className="text-right p-3 hidden sm:table-cell">Actual Hrs</th>
                    <th className="text-right p-3">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {quotedJobs.map(j => (
                    <tr key={j.id} className="hover:bg-white/5">
                      <td className="p-3"><span className="text-white font-bold">{j.poNumber}</span><br /><span className="text-zinc-600 text-[10px]">{j.customer}</span></td>
                      <td className="p-3 text-right font-mono text-zinc-300">{j.quotedAmt > 0 ? `$${j.quotedAmt.toLocaleString()}` : '-'}</td>
                      <td className="p-3 text-right font-mono text-orange-400">${j.actualCost.toFixed(0)}</td>
                      <td className="p-3 text-right font-mono text-blue-400">{j.estHrs > 0 ? `${j.estHrs.toFixed(1)}h` : '-'}</td>
                      <td className="p-3 text-right font-mono text-yellow-400 hidden sm:table-cell">{j.actualHrs.toFixed(1)}h</td>
                      <td className={`p-3 text-right font-mono font-bold text-xs ${j.costVariance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{j.costVariance >= 0 ? '+' : ''}{j.costVariance.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
