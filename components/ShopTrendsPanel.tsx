/**
 * ShopTrendsPanel — the Shop Brain's memory, on the dashboard.
 * Shows week-over-week direction (last complete week vs the 4-week normal):
 * revenue, hours, jobs shipped, on-time, margin, rework — plus which
 * customers are heating up or going quiet. Renders nothing until the shop
 * has ≥2 weeks of history, so young installs stay clean.
 */
import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, LineChart } from 'lucide-react';
import type { Job, TimeLog, ReworkEntry } from '../types';
import { computeShopTrends, fmtTrendValue, fmtTrendDelta } from '../utils/shopTrends';
import type { TrendMetric } from '../utils/shopTrends';

/** Tiny inline sparkline — no chart lib, prints the weekly series. */
const Spark = ({ series, good }: { series: number[]; good: boolean | null }) => {
  const W = 64, H = 20, P = 2;
  const max = Math.max(...series, 0.0001);
  const min = Math.min(...series, 0);
  const range = Math.max(0.0001, max - min);
  const pts = series.map((v, i) => {
    const x = P + (i * (W - 2 * P)) / Math.max(1, series.length - 1);
    const y = H - P - ((v - min) / range) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = good === null ? '#71717a' : good ? '#34d399' : '#f87171';
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <circle cx={pts[pts.length - 1]?.split(',')[0]} cy={pts[pts.length - 1]?.split(',')[1]} r="1.8" fill={stroke} />
    </svg>
  );
};

const DeltaChip = ({ m }: { m: TrendMetric }) => {
  const Icon = m.direction === 'up' ? TrendingUp : m.direction === 'down' ? TrendingDown : Minus;
  const cls = m.good === null || m.direction === 'flat'
    ? 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20'
    : m.good
      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
      : 'text-red-300 bg-red-500/10 border-red-500/25';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full border ${cls}`}>
      <Icon className="w-3 h-3" aria-hidden="true" /> {fmtTrendDelta(m)}
    </span>
  );
};

export const ShopTrendsPanel = ({ jobs, logs, rework }: {
  jobs: Job[]; logs: TimeLog[]; rework?: ReworkEntry[];
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return sessionStorage.getItem('trends_collapsed') === '1'; } catch { return false; }
  });
  const trends = useMemo(() => computeShopTrends(jobs, logs, rework || []), [jobs, logs, rework]);
  if (!trends.hasData) return null;

  const toggle = () => setCollapsed(prev => {
    const next = !prev;
    try { sessionStorage.setItem('trends_collapsed', next ? '1' : '0'); } catch {}
    return next;
  });

  const movers = [...trends.risingCustomers.map(m => ({ ...m, up: true })), ...trends.fallingCustomers.map(m => ({ ...m, up: false }))];

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      <button onClick={toggle} className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <LineChart className="w-4 h-4 text-sky-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 text-left">
            <p className="text-sm font-black text-white tracking-tight">Shop Trends</p>
            <p className="text-[11px] text-zinc-500 truncate">Last week vs your normal — where the shop is heading</p>
          </div>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            {trends.metrics.map(m => (
              <div key={m.key} className="bg-zinc-950/50 border border-white/5 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 truncate">{m.label}</p>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-lg font-black text-white tabular-nums">{fmtTrendValue(m.current, m.unit)}</span>
                    <DeltaChip m={m} />
                  </div>
                  <p className="text-[9px] text-zinc-600 mt-0.5">normal: {fmtTrendValue(m.baseline, m.unit)}</p>
                </div>
                <Spark series={m.series} good={m.direction === 'flat' ? null : m.good} />
              </div>
            ))}
          </div>

          {movers.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {movers.map(m => (
                <span key={m.customer + m.up} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${m.up ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' : 'text-red-300 bg-red-500/10 border-red-500/20'}`}>
                  {m.up ? <TrendingUp className="w-3 h-3" aria-hidden="true" /> : <TrendingDown className="w-3 h-3" aria-hidden="true" />}
                  {m.customer} · {fmtTrendValue(m.current, 'money')}/wk
                  <span className="opacity-60 font-normal">(norm {fmtTrendValue(m.baseline, 'money')})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShopTrendsPanel;
