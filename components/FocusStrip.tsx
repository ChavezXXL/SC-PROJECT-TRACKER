/**
 * FocusStrip — the Weekly Owner Report's punchline, on the dashboard.
 * Shows the top 1–3 "focus this week" items the moment the owner opens the
 * app, with a jump to the full report. Uses the SAME shared engine as the
 * report (computeWeeklyFocus), so the dashboard and the report always agree.
 */
import React, { useMemo } from 'react';
import {
  Target, TrendingDown, DollarSign, AlertTriangle, ClipboardCheck,
  Users as UsersIcon, ArrowRight,
} from 'lucide-react';
import type { Job, TimeLog, ReworkEntry, ShopAction, User, SystemSettings } from '../types';
import { computeShopTrends } from '../utils/shopTrends';
import { computeCustomerIntel } from '../utils/customerIntel';
import { computePriceDoctor } from '../utils/priceDoctor';
import { computeTimekeepingHealth } from '../utils/timekeepingHealth';
import { computeWeeklyFocus, type FocusIcon } from '../utils/weeklyFocus';

const ICON: Record<FocusIcon, React.ReactNode> = {
  'revenue-down': <TrendingDown className="w-4 h-4" />,
  concentration: <UsersIcon className="w-4 h-4" />,
  quiet: <TrendingDown className="w-4 h-4" />,
  money: <DollarSign className="w-4 h-4" />,
  health: <AlertTriangle className="w-4 h-4" />,
  actions: <ClipboardCheck className="w-4 h-4" />,
  rework: <AlertTriangle className="w-4 h-4" />,
  'all-clear': <Target className="w-4 h-4" />,
};
const TONE: Record<'red' | 'amber' | 'emerald', string> = {
  red: 'text-red-400',
  amber: 'text-amber-400',
  emerald: 'text-emerald-400',
};

export const FocusStrip = ({ jobs, logs, rework, actions, users, settings, onOpen }: {
  jobs: Job[]; logs: TimeLog[]; rework: ReworkEntry[]; actions: ShopAction[];
  users: User[]; settings: SystemSettings; onOpen: () => void;
}) => {
  const now = useMemo(() => Date.now(), []);
  const items = useMemo(() => {
    const trends = computeShopTrends(jobs, logs, rework, now, 6);
    const intel = computeCustomerIntel(jobs, logs, now);
    const doctor = computePriceDoctor(jobs, logs, settings, now, 35);
    const health = computeTimekeepingHealth({ logs, jobs, users, settings, now, windowDays: 45 });
    const openActions = actions.filter(a => !a.done);
    return computeWeeklyFocus({ trends, intel, doctor, health, openActions, now });
  }, [jobs, logs, rework, actions, users, settings, now]);

  // Nothing to show until there's some activity.
  if (jobs.length === 0 && logs.length === 0) return null;

  const allClear = items.length === 1 && items[0].icon === 'all-clear';
  const top = items.slice(0, 3);

  return (
    <button
      onClick={onOpen}
      aria-label="Open the Weekly Owner Report"
      className={`group w-full text-left rounded-2xl border p-4 transition-all active:scale-[0.995] ${
        allClear
          ? 'bg-emerald-500/[0.06] border-emerald-500/20 hover:border-emerald-500/35'
          : 'bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] border-amber-500/20 hover:border-amber-500/40'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <Target className={`w-4 h-4 ${allClear ? 'text-emerald-400' : 'text-amber-400'}`} />
          <span className="text-sm font-black text-white tracking-tight">Focus this week</span>
          {!allClear && top.length > 1 && (
            <span className="text-[10px] font-black text-amber-300 bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.5 rounded-full">{items.length}</span>
          )}
        </div>
        <span className="text-[11px] font-bold text-zinc-500 group-hover:text-amber-300 flex items-center gap-1 shrink-0 transition-colors">
          Full report <ArrowRight className="w-3 h-3" />
        </span>
      </div>
      <ul className="space-y-1.5">
        {top.map(f => (
          <li key={f.key} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-0.5 shrink-0 ${TONE[f.tone]}`}>{ICON[f.icon]}</span>
            <span className="text-zinc-200 leading-snug">{f.text}</span>
          </li>
        ))}
      </ul>
      {!allClear && items.length > top.length && (
        <p className="text-[11px] text-zinc-500 mt-2 pl-6.5">+{items.length - top.length} more in the full report</p>
      )}
    </button>
  );
};

export default FocusStrip;
