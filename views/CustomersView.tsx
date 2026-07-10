// CustomersView — "Customer Intelligence". The owner's lowest-cost growth is
// inside customers already buying: this view ranks every customer by value,
// flags who's going quiet, and shows how concentrated revenue is on one shop.
// All math lives in utils/customerIntel.ts (pure) — this file only renders.
import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, Building2, Search, ChevronDown, ChevronRight, DollarSign,
  AlertTriangle, Moon, PieChart, Clock, Copy,
} from 'lucide-react';

import type { Job, TimeLog } from '../types';
import * as DB from '../services/mockDb';
import { computeCustomerIntel } from '../utils/customerIntel';
import type { CustomerProfile } from '../utils/customerIntel';

// ── tiny formatters ──────────────────────────────────────────────────────────
/** $ with k-format: $850 / $12.4k / $1.2M. */
const fmtMoney = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
};
const fmtPct = (v: number | null, digits = 0): string =>
  v === null ? '—' : `${v.toFixed(digits)}%`;
const fmtHours = (h: number): string =>
  h >= 100 ? `${Math.round(h)}h` : h >= 10 ? `${h.toFixed(0)}h` : `${h.toFixed(1)}h`;
const fmtQuiet = (days: number): string =>
  days >= 9999 ? 'never' : days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;

/** Traffic-light text color for a "higher is better" percentage. */
const rateColor = (v: number | null, green: number, amber: number): string =>
  v === null ? 'text-zinc-600' : v >= green ? 'text-emerald-400' : v >= amber ? 'text-amber-400' : 'text-red-400';

// ── tiny inline sparkline (same pattern as ShopTrendsPanel's Spark) ──────────
const Spark = ({ series, good }: { series: number[]; good: boolean | null }) => {
  const W = 72, H = 22, P = 2;
  const max = Math.max(...series, 0.0001);
  const min = Math.min(...series, 0);
  const range = Math.max(0.0001, max - min);
  const pts = series.map((v, i) => {
    const x = P + (i * (W - 2 * P)) / Math.max(1, series.length - 1);
    const y = H - P - ((v - min) / range) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = good === null ? '#71717a' : good ? '#34d399' : '#f87171';
  const last = pts[pts.length - 1]?.split(',');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      {last && <circle cx={last[0]} cy={last[1]} r="1.8" fill={stroke} />}
    </svg>
  );
};

/** Trend direction for the sparkline color: last 4 weeks vs the 4 before. */
const sparkGood = (weekly: number[]): boolean | null => {
  const half = Math.floor(weekly.length / 2);
  const older = weekly.slice(0, half).reduce((s, v) => s + v, 0);
  const recent = weekly.slice(half).reduce((s, v) => s + v, 0);
  if (older === 0 && recent === 0) return null;
  if (recent === older) return null;
  return recent > older;
};

// ── summary stat card ────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, sub, tone = 'default' }: {
  icon: any; label: string; value: string; sub?: React.ReactNode;
  tone?: 'default' | 'amber' | 'red';
}) => {
  const border = tone === 'red' ? 'border-red-500/30' : tone === 'amber' ? 'border-amber-500/30' : 'border-white/5';
  const valColor = tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-white';
  const iconColor = tone === 'red' ? 'text-red-400' : 'text-amber-500';
  return (
    <div className={`bg-zinc-900/50 border ${border} rounded-2xl p-4 min-w-0`}>
      <div className="flex items-center gap-1.5 text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} /> {label}
      </div>
      <p className={`text-2xl font-black tracking-tight truncate ${valColor}`}>{value}</p>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
};

// ── the view ─────────────────────────────────────────────────────────────────
export const CustomersView = ({ addToast }: any) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeLogs(setLogs);
    return () => { u1(); u2(); };
  }, []);

  const intel = useMemo(() => computeCustomerIntel(jobs, logs), [jobs, logs]);

  const activeCount = useMemo(() => intel.profiles.filter(p => p.revenue90d > 0).length, [intel]);
  const quietList = useMemo(() => intel.profiles.filter(p => p.goingQuiet), [intel]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return intel.profiles;
    return intel.profiles.filter(p =>
      p.name.toLowerCase().includes(q) || p.parts.some(pt => pt.toLowerCase().includes(q)));
  }, [intel.profiles, search]);

  const toggle = (key: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const copyPart = (part: string) => {
    try {
      navigator.clipboard?.writeText(part);
      addToast?.('success', `${part} copied`);
    } catch { /* clipboard unavailable — no-op */ }
  };

  // Concentration tone: ≥60% red, ≥40% amber.
  const share = intel.topSharePct;
  const shareTone: 'default' | 'amber' | 'red' = share !== null && share >= 60 ? 'red' : share !== null && share >= 40 ? 'amber' : 'default';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight">
          <Users className="w-6 h-6 text-amber-500" /> Customers
        </h2>
        <p className="text-zinc-500 text-sm mt-0.5">Who's growing, who's going quiet — your growth is inside shops already buying.</p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={DollarSign} label="Revenue · 90d" value={fmtMoney(intel.totalRevenue90d)}
          sub={`${intel.profiles.reduce((s, p) => s + p.jobsCompleted90d, 0)} jobs shipped`} />
        <StatCard icon={Building2} label="Active customers" value={String(activeCount)}
          sub={`${intel.profiles.length} all time`} />
        <StatCard icon={PieChart} label="Top concentration" value={fmtPct(share)} tone={shareTone}
          sub={share === null ? 'no revenue yet' : (
            <>
              <span className="truncate">{intel.topShareName}</span>
              {share >= 40 && <span className={share >= 60 ? 'text-red-400 font-bold' : 'text-amber-400 font-bold'}> · over-dependent on one shop</span>}
            </>
          )} />
        <StatCard icon={Moon} label="Going quiet" value={String(quietList.length)} tone={quietList.length > 0 ? 'amber' : 'default'}
          sub={quietList.length > 0 ? 'silent 21+ days — reach out' : 'everyone’s active'} />
      </div>

      {/* Going-quiet callout */}
      {quietList.length > 0 && (
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/[0.04] border border-orange-500/25 rounded-2xl p-4">
          <h3 className="font-black text-orange-200 flex items-center gap-2 text-sm mb-1">
            <AlertTriangle className="w-4 h-4" /> Going quiet — {quietList.length}
          </h3>
          <p className="text-[11px] text-orange-300/70 mb-3">Regular customers who've gone silent. A five-minute call now is cheaper than a new customer later.</p>
          <div className="space-y-1.5">
            {quietList.map(p => (
              <div key={p.key} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 min-h-[44px]">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{p.name}</p>
                  <p className="text-[10px] text-zinc-500">
                    <span className="text-red-400 font-bold">{p.daysQuiet} days silent</span>
                    {' · '}{fmtMoney(p.revenue90d)} last 90d · {p.jobsCompletedAll} jobs all time
                  </p>
                </div>
                <Spark series={p.weeklyRevenue} good={false} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers or part numbers…"
          className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none" />
      </div>

      {/* Empty states */}
      {intel.profiles.length === 0 && (
        <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
          <div className="inline-block p-4 rounded-full bg-zinc-800 mb-3"><Users className="w-8 h-8 text-zinc-600" /></div>
          <p className="font-medium">No customer history yet.</p>
          <p className="text-sm mt-1 text-zinc-600">As jobs come in and ship, every customer's revenue, reliability and trend shows up here.</p>
        </div>
      )}
      {intel.profiles.length > 0 && filtered.length === 0 && (
        <div className="p-8 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
          <p className="font-medium">No customers match "{search}".</p>
          <button onClick={() => setSearch('')} className="text-sm mt-1 text-amber-400 font-bold">Clear search</button>
        </div>
      )}

      {/* Ranked list */}
      <div className="space-y-2">
        {filtered.map((p: CustomerProfile, i: number) => {
          const isOpen = expanded.has(p.key);
          return (
            <div key={p.key} className={`bg-zinc-900/40 border rounded-2xl overflow-hidden ${p.goingQuiet ? 'border-orange-500/25' : 'border-white/5'}`}>
              {/* Row header — whole thing toggles */}
              <button onClick={() => toggle(p.key)} className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <span className="text-[11px] font-mono text-zinc-600 w-5 text-right shrink-0">{i + 1}</span>

                  {/* Name + last-active + share bar */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-black text-white truncate">{p.name}</span>
                      <span className={`text-[10px] shrink-0 flex items-center gap-1 ${p.goingQuiet ? 'text-red-400 font-bold' : 'text-zinc-500'}`}>
                        <Clock className="w-2.5 h-2.5" /> {fmtQuiet(p.daysQuiet)}
                      </span>
                    </div>
                    {/* Share of 90d revenue */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1 flex-1 max-w-[180px] bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full" style={{ width: `${Math.min(100, Math.max(p.sharePct > 0 ? 2 : 0, p.sharePct))}%` }} />
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0">{p.sharePct.toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Trend + money */}
                  <div className="hidden sm:block"><Spark series={p.weeklyRevenue} good={sparkGood(p.weeklyRevenue)} /></div>
                  <div className="text-right shrink-0 w-[74px]">
                    <p className="text-base font-black text-white leading-tight">{fmtMoney(p.revenue90d)}</p>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-wider">90 days</p>
                  </div>
                  {isOpen ? <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0" />}
                </div>

                {/* Stat strip */}
                <div className="mt-2 pl-8 grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-zinc-400"><span className="font-bold text-white">{p.jobsOpen}</span> open · <span className="font-bold text-white">{p.jobsCompleted90d}</span> done 90d</span>
                  <span className="text-zinc-500">on-time <span className={`font-bold ${rateColor(p.onTimeRate, 90, 70)}`}>{fmtPct(p.onTimeRate)}</span>{p.lateCount > 0 && <span className="text-zinc-600"> · {p.lateCount} late</span>}</span>
                  <span className="text-zinc-500">margin <span className={`font-bold ${rateColor(p.avgMarginPct, 30, 10)}`}>{fmtPct(p.avgMarginPct)}</span></span>
                  <span className="text-zinc-500">labor <span className="font-bold text-zinc-300">{fmtHours(p.laborHours90d)}</span> 90d</span>
                  <span className="text-zinc-600 sm:hidden col-span-2"><Spark series={p.weeklyRevenue} good={sparkGood(p.weeklyRevenue)} /></span>
                </div>
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div className="px-4 pb-4 pl-12 border-t border-white/5 pt-3 space-y-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
                    <span>all-time revenue <span className="font-bold text-emerald-400">{fmtMoney(p.revenueAll)}</span></span>
                    <span>all-time jobs <span className="font-bold text-white">{p.jobsCompletedAll}</span></span>
                    {p.lastActivity > 0 && <span>last active <span className={`font-bold ${p.goingQuiet ? 'text-red-400' : 'text-zinc-300'}`}>{new Date(p.lastActivity).toLocaleDateString()}</span></span>}
                  </div>
                  {p.parts.length > 0 ? (
                    <div>
                      <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1.5">Parts run (recent first) — tap to copy</p>
                      <div className="flex flex-wrap gap-1.5">
                        {p.parts.map(part => (
                          <button key={part} onClick={() => copyPart(part)} title="Copy part number"
                            className="bg-zinc-800 hover:bg-amber-600 hover:text-white text-[11px] font-mono text-zinc-300 px-2 py-1 rounded-lg border border-white/10 transition-colors inline-flex items-center gap-1">
                            {part} <Copy className="w-2.5 h-2.5 opacity-40" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-600">No part numbers on file for this customer.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomersView;
