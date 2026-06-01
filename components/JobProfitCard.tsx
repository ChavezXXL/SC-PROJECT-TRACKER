/**
 * JobProfitCard — shows the full revenue / cost / margin breakdown for a job.
 *
 * Two modes:
 *   live      — re-calculated from current logs (used on open jobs)
 *   snapshot  — reads job.profitSnapshot (locked at completion, always accurate)
 */

import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, DollarSign, Clock, Package, Truck } from 'lucide-react';
import type { Job, TimeLog, User, SystemSettings, PurchaseOrder } from '../types';
import { calcJobProfit, fmtDollar, GRADE_COLORS, GRADE_LABELS, type JobProfitBreakdown } from '../utils/jobProfit';

// ── Helpers ────────────────────────────────────────────────────────────

function fmtHours(h: number): string {
  if (h < 0.1) return '< 6 min';
  const whole = Math.floor(h);
  const mins  = Math.round((h - whole) * 60);
  if (whole === 0) return `${mins}m`;
  if (mins  === 0) return `${whole}h`;
  return `${whole}h ${mins}m`;
}

function GradeIcon({ grade }: { grade: JobProfitBreakdown['grade'] }) {
  if (grade === 'great' || grade === 'good') return <TrendingUp  className="w-4 h-4" />;
  if (grade === 'loss')                      return <TrendingDown className="w-4 h-4" />;
  return <Minus className="w-4 h-4" />;
}

// ── Row ────────────────────────────────────────────────────────────────

function Row({ icon, label, value, sub, negative }: {
  icon:      React.ReactNode;
  label:     string;
  value:     string;
  sub?:      string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex items-center gap-2 text-zinc-400">
        <span className="w-4 h-4 flex-shrink-0">{icon}</span>
        <span>{label}</span>
        {sub && <span className="text-xs text-zinc-600">{sub}</span>}
      </div>
      <span className={negative ? 'text-red-400' : 'text-zinc-200'}>{value}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────

interface JobProfitCardProps {
  job:        Job;
  allLogs:    TimeLog[];
  allUsers:   User[];
  settings:   SystemSettings;
  allPOs:     PurchaseOrder[];
  /** If true, show the locked snapshot instead of recalculating */
  useSnapshot?: boolean;
  /** Compact = no worker breakdown, just the summary row */
  compact?:     boolean;
}

export const JobProfitCard: React.FC<JobProfitCardProps> = ({
  job, allLogs, allUsers, settings, allPOs, useSnapshot = false, compact = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Choose data source
  const snap = job.profitSnapshot;
  const hasSnapshot = !!snap;

  const live = React.useMemo(
    () => calcJobProfit(job, allLogs, allUsers, settings, allPOs),
    [job, allLogs, allUsers, settings, allPOs],
  );

  // Prefer snapshot when available (immutable, authoritative)
  const d: JobProfitBreakdown = (useSnapshot && hasSnapshot)
    ? {
        revenue:        snap!.revenue,
        laborCost:      snap!.laborCost,
        materialCost:   snap!.materialCost,
        outsourcedCost: snap!.outsourcedCost,
        totalCost:      snap!.totalCost,
        profit:         snap!.profit,
        marginPct:      snap!.marginPct,
        laborHours:     snap!.laborHours,
        revenuePerHour: snap!.laborHours > 0 ? snap!.revenue / snap!.laborHours : 0,
        grade: snap!.marginPct >= 35 ? 'great' : snap!.marginPct >= 15 ? 'good' : snap!.marginPct >= 0 ? 'tight' : 'loss',
        workerLines: [],
      }
    : live;

  const colors = GRADE_COLORS[d.grade];
  const noQuote = !job.quoteAmount;

  if (noQuote) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/3 px-4 py-3 text-sm text-zinc-500">
        No quote amount set — add one to see profitability
      </div>
    );
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${colors.bg} ${colors.border}`}>
        <span className={`flex items-center gap-1 font-bold ${colors.text}`}>
          <GradeIcon grade={d.grade} />
          {fmtDollar(d.profit)}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors.badge}`}>
          {d.marginPct.toFixed(0)}% margin
        </span>
        <span className="text-xs text-zinc-500 ml-auto">
          {GRADE_LABELS[d.grade]}
        </span>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border ${colors.border} ${colors.bg} overflow-hidden`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-lg font-black ${colors.text}`}>
            <GradeIcon grade={d.grade} />
            {fmtDollar(d.profit)}
          </div>
          <span className={`text-sm font-bold px-2.5 py-1 rounded-full ${colors.badge}`}>
            {d.marginPct.toFixed(1)}% margin
          </span>
          <span className="text-xs text-zinc-500">{GRADE_LABELS[d.grade]}</span>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* ── Summary bar ── */}
      {d.revenue > 0 && (
        <div className="mx-5 mb-4">
          {/* Progress bar — how much of revenue is cost */}
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                d.grade === 'great' ? 'bg-emerald-500' :
                d.grade === 'good'  ? 'bg-blue-500' :
                d.grade === 'tight' ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, d.marginPct))}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-zinc-600">
            <span>0%</span>
            <span className={colors.text}>{d.marginPct.toFixed(1)}% profit</span>
            <span>100%</span>
          </div>
        </div>
      )}

      {/* ── Breakdown (expanded) ── */}
      {expanded && (
        <div className="border-t border-white/5 px-5 py-3 space-y-0.5">
          <Row
            icon={<DollarSign className="w-4 h-4 text-emerald-400" />}
            label="Revenue"
            value={fmtDollar(d.revenue)}
          />
          <div className="border-t border-white/5 my-2" />
          <Row
            icon={<Clock className="w-4 h-4" />}
            label="Labor"
            sub={`${fmtHours(d.laborHours)}`}
            value={`− ${fmtDollar(d.laborCost)}`}
            negative
          />
          <Row
            icon={<Package className="w-4 h-4" />}
            label="Materials"
            value={d.materialCost > 0 ? `− ${fmtDollar(d.materialCost)}` : '—'}
            negative={d.materialCost > 0}
          />
          <Row
            icon={<Truck className="w-4 h-4" />}
            label="Outsourced"
            value={d.outsourcedCost > 0 ? `− ${fmtDollar(d.outsourcedCost)}` : '—'}
            negative={d.outsourcedCost > 0}
          />
          <div className="border-t border-white/5 my-2" />
          <div className="flex justify-between py-1 text-sm font-bold">
            <span className="text-zinc-300">Net Profit</span>
            <span className={d.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {fmtDollar(d.profit)}
            </span>
          </div>
          {d.revenuePerHour > 0 && (
            <div className="text-xs text-zinc-600 text-right pt-1">
              {fmtDollar(d.revenuePerHour)}/hr revenue
            </div>
          )}

          {/* Per-worker breakdown */}
          {!hasSnapshot && d.workerLines.length > 0 && (
            <div className="pt-3 mt-1 border-t border-white/5">
              <div className="text-xs text-zinc-600 mb-2">Labor breakdown</div>
              {d.workerLines.map((w, i) => (
                <div key={i} className="flex justify-between text-xs text-zinc-500 py-0.5">
                  <span>{w.name}</span>
                  <span>{fmtHours(w.hours)} · {fmtDollar(w.cost)}</span>
                </div>
              ))}
            </div>
          )}

          {hasSnapshot && snap && (
            <div className="text-[10px] text-zinc-700 text-right pt-2">
              Locked {new Date(snap.snappedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default JobProfitCard;
