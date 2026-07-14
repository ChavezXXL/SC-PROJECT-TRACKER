/**
 * RiskBadge — UI for the Green/Yellow/Red job control system (utils/jobRisk).
 *
 *   <RiskPill/>        tiny tier pill for job cards & table rows
 *   <FamiliarityChip/> "you've run this part" — personal, per worker
 *   <RiskBanner/>      worker-facing banner inside an expanded job card
 *   <RiskCrewPanel/>   admin panel: tier + reasons + crew experience + override
 */
import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, Star, CheckCircle2, User as UserIcon, Wrench } from 'lucide-react';
import type { Job } from '../types';
import {
  type JobRisk, type Familiarity, type WorkerPartExperience, type RiskTier,
  type RiskIndex, computeJobRisk, partVeterans, partFamilyKey, TIER_LABEL,
} from '../utils/jobRisk';

const PILL: Record<RiskTier, string> = {
  green: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  yellow: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  red: 'text-red-400 bg-red-500/10 border-red-500/30',
};
const DOT: Record<RiskTier, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400 animate-pulse',
};

/** Tiny tier pill. title carries the top reason so hover explains itself. */
export const RiskPill = ({ risk }: { risk: JobRisk }) => (
  <span
    title={risk.reasons[0] || ''}
    className={`inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded border ${PILL[risk.tier]}`}
  >
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[risk.tier]}`} />
    {TIER_LABEL[risk.tier]}{risk.overridden ? ' *' : ''}
  </span>
);

/** Personal familiarity chip — the "to each their own" layer. */
export const FamiliarityChip = ({ fam }: { fam: Familiarity }) => {
  if (fam.level === 'expert') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> You know this part · {fam.runs} run{fam.runs !== 1 ? 's' : ''}
      </span>
    );
  }
  if (fam.level === 'familiar') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400/90 bg-emerald-500/5 border border-emerald-500/25 px-1.5 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> You've run this before
      </span>
    );
  }
  if (fam.level === 'family') {
    return (
      <span
        title={fam.familyParts?.length ? `You've run: ${fam.familyParts.join(', ')}` : undefined}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-300 bg-teal-500/10 border border-teal-500/25 px-1.5 py-0.5 rounded-full"
      >
        <CheckCircle2 className="w-3 h-3" /> You've run similar parts · ×{fam.familyRuns}
      </span>
    );
  }
  if (fam.level === 'ops') {
    const top = fam.knownOps?.[0];
    return (
      <span
        title={fam.knownOps?.map(o => `${o.op} ×${o.jobs}`).join(', ')}
        className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/25 px-1.5 py-0.5 rounded-full"
      >
        <Wrench className="w-3 h-3" /> You know the ops{top ? ` · ${top.op} ×${top.jobs}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
      <Star className="w-3 h-3" /> New to you
    </span>
  );
};

const vetsLine = (vets: WorkerPartExperience[]): string =>
  vets.map(v => `${(v.userName || 'Someone').split(' ')[0]} (${v.runs} run${v.runs !== 1 ? 's' : ''}${v.viaSimilar ? ', similar part' : ''})`).join(', ');

/** One personal context line for yellow/red banners — what THIS worker brings. */
const famContext = (fam: Familiarity, vets: WorkerPartExperience[]): React.ReactNode => {
  if (fam.level === 'family') {
    return <> · You've run similar parts ×{fam.familyRuns}{fam.familyParts?.length ? ` (${fam.familyParts.join(', ')})` : ''} — same concept.</>;
  }
  if (fam.level === 'ops') {
    const tops = (fam.knownOps || []).map(o => `${o.op} ×${o.jobs}`).join(', ');
    return <> · You know the ops from other parts ({tops}).</>;
  }
  if (fam.level === 'new' && vets.length > 0) {
    return <> · New to you — ask {vetsLine(vets)}.</>;
  }
  return null;
};

/**
 * Worker-facing banner in the expanded job card. Shows only when there's
 * something to say: red/yellow tier, or a green job this worker has NO
 * connection to (exact, sibling-part, or operation experience all count —
 * people who effectively know the work don't get nagged).
 */
export const RiskBanner = ({ risk, fam, vets }: { risk: JobRisk; fam: Familiarity; vets: WorkerPartExperience[] }) => {
  if (risk.tier === 'green' && fam.level !== 'new') return null;

  if (risk.tier === 'red') {
    return (
      <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
        <p className="text-sm font-black text-red-300 flex items-center gap-1.5">
          <ShieldX className="w-4 h-4 shrink-0" /> RED JOB — {risk.guidance}
        </p>
        <p className="text-xs text-red-200/80 mt-1">{risk.reasons[0]}{famContext(fam, [])}</p>
      </div>
    );
  }
  if (risk.tier === 'yellow') {
    return (
      <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
        <p className="text-sm font-black text-amber-300 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 shrink-0" /> YELLOW JOB — {risk.guidance}
        </p>
        <p className="text-xs text-amber-200/80 mt-1">
          {risk.reasons[0]}
          {famContext(fam, vets)}
        </p>
      </div>
    );
  }
  // Green, and this worker has no connection to the part at all.
  return (
    <div className="mb-3 p-3 rounded-xl bg-sky-500/10 border border-sky-500/25">
      <p className="text-sm font-black text-sky-300 flex items-center gap-1.5">
        <ShieldCheck className="w-4 h-4 shrink-0" /> {risk.overridden ? 'Marked green by the office' : 'Proven part'} — but your first time on it
      </p>
      <p className="text-xs text-sky-200/80 mt-1">
        {vets.length > 0 ? <>Ask {vetsLine(vets)} how it runs before you start.</> : 'Check the notes and photos before you start.'}
      </p>
    </div>
  );
};

/**
 * Admin "Risk & Crew" panel for the job modal. Live-computes the tier from
 * whatever is currently typed (part number, qty, price), lists who's run the
 * part, and lets the admin override the tier (null clears back to auto —
 * sanitize() keeps null so the clear persists through Firestore merge).
 */
export const RiskCrewPanel = ({ job, index, onChange }: {
  job: Partial<Job>;
  index: RiskIndex;
  onChange: (patch: Partial<Job>) => void;
}) => {
  if (!(job.partNumber || '').trim()) return null;
  const risk = computeJobRisk(job as Job, index);
  const vets = partVeterans(job.partNumber, index, undefined, 6);
  const pnNorm = (job.partNumber || '').trim().toLowerCase();
  const siblings = (index.families.get(partFamilyKey(job.partNumber))?.parts || [])
    .filter(p => p.trim().toLowerCase() !== pnNorm)
    .slice(0, 4);
  const current: RiskTier | 'auto' = job.riskOverride || 'auto';

  const btn = (val: RiskTier | 'auto', label: string, aria: string, cls: string) => (
    <button
      type="button"
      aria-label={aria}
      aria-pressed={current === val}
      // Switching tiers resets the note — a reason written for RED shouldn't
      // silently ride along to GREEN.
      onClick={() => onChange(val === 'auto'
        ? { riskOverride: null as any, riskNote: null as any }
        : { riskOverride: val, ...(val !== current ? { riskNote: null as any } : {}) })}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-black border transition-all active:scale-95 ${current === val ? cls : 'text-zinc-500 border-white/10 hover:text-zinc-300 hover:border-white/20'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-zinc-950/60 border border-white/10 rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Job Risk</span>
          <RiskPill risk={risk} />
          {risk.overridden && <span className="text-[10px] text-zinc-500">auto: {TIER_LABEL[risk.autoTier]}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {btn('auto', 'Auto', 'Use automatic tier', 'text-zinc-200 border-white/30 bg-white/5')}
          {btn('green', 'G', 'Override tier to green', 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10')}
          {btn('yellow', 'Y', 'Override tier to yellow', 'text-amber-300 border-amber-500/40 bg-amber-500/10')}
          {btn('red', 'R', 'Override tier to red', 'text-red-300 border-red-500/40 bg-red-500/10')}
        </div>
      </div>
      <ul className="space-y-0.5">
        {risk.reasons.slice(0, 3).map((r, i) => (
          <li key={i} className="text-xs text-zinc-400 flex items-start gap-1.5">
            <span className="text-zinc-600 mt-0.5">•</span>{r}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-zinc-500 italic">{risk.guidance}</p>
      {job.riskOverride && (
        <input
          value={job.riskNote || ''}
          onChange={e => onChange({ riskNote: e.target.value })}
          placeholder="Why the override? (e.g. flight-critical, unclear edge break)"
          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-amber-500/40"
        />
      )}
      {siblings.length > 0 && (
        <p className="text-[11px] text-zinc-500 pt-1">
          <span className="font-bold text-zinc-400">Similar parts on file:</span> {siblings.join(', ')}
        </p>
      )}
      {vets.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1.5">
            Who's run this part{vets[0]?.viaSimilar ? ' (via similar parts)' : ''}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {vets.map(v => (
              <span key={v.userId} className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-300 bg-zinc-900 border border-white/10 px-2 py-1 rounded-lg">
                <UserIcon className="w-3 h-3 text-zinc-500" />
                {(v.userName || 'Unknown').split(' ')[0]}
                <span className="text-zinc-500 font-medium">×{v.runs} · {Math.round(v.minutes / 60 * 10) / 10}h{v.viaSimilar ? ' · similar' : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {vets.length === 0 && (
        <p className="text-[11px] text-amber-400/80 pt-1 border-t border-white/5">Nobody has logged time on this part (or similar parts) yet.</p>
      )}
    </div>
  );
};
