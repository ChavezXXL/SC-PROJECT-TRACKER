// ═════════════════════════════════════════════════════════════════════
// Job view — what tapping a job opens: everything about it at a glance,
// read-only, with the everyday actions and "Edit job" pinned at the bottom.
// (Tapping a job used to drop straight into the edit form.)
// ═════════════════════════════════════════════════════════════════════

import React from 'react';
import { Play, ArrowRight, CheckCircle, Printer, Edit2, Camera, Clock, Paperclip, AlertTriangle, StickyNote, Users } from 'lucide-react';
import type { Job, JobStage, TimeLog } from '../types';
import { Modal } from './Modal';
import { dueState, dueLabel } from '../utils/dueDates';
import { stepDone, stepTickedBy, logMinutes, fmtMinutes } from '../utils/jobSteps';
import { getWorkingElapsedMs } from '../services/mockDb';

export interface JobViewProps {
  job: Job;
  stages: JobStage[];
  currentStage: JobStage;
  nextStage: JobStage | null;
  /** Show the Done button (job not completed and a complete stage exists). */
  canComplete: boolean;
  logs: TimeLog[];
  activeLogs: TimeLog[];
  /** Customer name and money are for the office. */
  showCustomer: boolean;
  printed: boolean;
  openRework: number;
  onClose: () => void;
  onEdit: () => void;
  onStart: () => void;
  onAdvance: () => void;
  onComplete: () => void;
  onPrint: () => void;
  onPhoto: (input: HTMLInputElement) => void;
  onOpenPhoto: (url: string) => void;
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</p>
    <div className="text-sm font-bold text-white mt-0.5 break-words">{children}</div>
  </div>
);

const Section = ({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
    <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400 mb-2">{icon}{title}</h3>
    {children}
  </section>
);

export const JobView: React.FC<JobViewProps> = ({
  job, stages, currentStage, nextStage, canComplete, logs, activeLogs, showCustomer, printed, openRework,
  onClose, onEdit, onStart, onAdvance, onComplete, onPrint, onPhoto, onOpenPhoto,
}) => {
  const due = dueState(job);
  const late = due === 'overdue';
  const dueTone = late ? 'text-red-400 border-red-500/30 bg-red-500/10'
    : due === 'today' ? 'text-orange-300 border-orange-500/30 bg-orange-500/10'
    : due === 'soon' ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
    : 'text-zinc-200 border-white/10 bg-white/5';

  const jobLogs = logs.filter(l => l.jobId === job.id);
  const running = activeLogs.filter(l => l.jobId === job.id && !l.endTime);
  const doneMins = jobLogs.filter(l => l.endTime).reduce((a, l) => a + logMinutes(l), 0);
  const runningMins = running.reduce((a, l) => a + getWorkingElapsedMs(l) / 60000, 0);
  const totalMins = doneMins + runningMins;
  const budgetMins = (job.expectedHours || 0) * 60;
  const recent = [...jobLogs].filter(l => l.endTime).sort((a, b) => b.startTime - a.startTime).slice(0, 5);
  const steps = job.checklist || [];
  const stageIdx = Math.max(0, stages.findIndex(s => s.id === currentStage.id));
  const notes = [...(job.jobNotes || [])].sort((a, b) => b.timestamp - a.timestamp);

  const footer = (
    <div className="w-full space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={onStart} className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-500/15 text-amber-400 font-bold text-sm hover:bg-amber-500 hover:text-white transition-colors">
          <Play className="w-4 h-4 shrink-0" aria-hidden="true" /> Start
        </button>
        {nextStage && (
          <button type="button" onClick={onAdvance} title={`Move to ${nextStage.label}`}
            className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm transition-colors"
            style={{ background: `${nextStage.color}20`, color: nextStage.color }}>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" /><span className="truncate">{nextStage.label}</span>
          </button>
        )}
        {canComplete && (
          <button type="button" onClick={onComplete} className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 font-bold text-sm hover:bg-emerald-500 hover:text-white transition-colors">
            <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> Done
          </button>
        )}
        <button type="button" onClick={onPrint} aria-label={printed ? 'Reprint traveler' : 'Print traveler'} title={printed ? 'Printed ✓ — reprint' : 'Print traveler'}
          className={`shrink-0 px-3 rounded-xl flex items-center justify-center transition-colors ${printed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`}>
          <Printer className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <button type="button" onClick={onEdit} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white font-black text-sm shadow-lg shadow-amber-900/30 active:scale-[0.99] transition-transform">
        <Edit2 className="w-4 h-4" aria-hidden="true" /> Edit job
      </button>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`PO ${job.poNumber}`} subtitle={job.jobIdsDisplay && job.jobIdsDisplay !== job.poNumber ? `Job ${job.jobIdsDisplay}` : undefined} footer={footer}>
      {/* Due + stage — the first thing anyone needs */}
      <div className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-3 ${dueTone}`}>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Due</p>
          <p className="font-mono font-black text-lg leading-tight">{job.dueDate || 'No due date'}</p>
        </div>
        {job.dueDate && due !== 'closed' && due !== 'none' && (
          <span className="shrink-0 font-black text-sm">{dueLabel(job.dueDate)}</span>
        )}
        {due === 'closed' && <span className="shrink-0 font-black text-sm text-emerald-400">Finished</span>}
      </div>

      {/* Photo */}
      {job.partImage ? (
        <button type="button" onClick={() => onOpenPhoto(job.partImage!)} className="block w-full rounded-xl overflow-hidden border border-white/10 bg-black">
          <img src={job.partImage} alt={`${job.partNumber} part`} className="w-full max-h-72 object-contain" />
          {(job as any).photoInherited && (
            <p className="text-[11px] text-zinc-500 py-1.5 bg-zinc-900">Photo from an earlier run of this part{(job as any).photoFromPo ? ` (PO ${(job as any).photoFromPo})` : ''}</p>
          )}
        </button>
      ) : (
        <label className="flex flex-col items-center justify-center gap-1.5 w-full h-32 rounded-xl border-2 border-dashed border-cyan-500/40 bg-cyan-500/5 text-cyan-300 font-bold text-sm cursor-pointer active:scale-[0.99]">
          <Camera className="w-7 h-7" aria-hidden="true" />
          Take a photo of this part
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => onPhoto(e.currentTarget)} />
        </label>
      )}

      {/* The part */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Part">{job.partNumber || '—'}</Fact>
        <Fact label="Quantity">{job.quantity ? Number(job.quantity).toLocaleString() : '—'}</Fact>
        {showCustomer && <Fact label="Customer">{job.customer || '—'}</Fact>}
        <Fact label="Stage">
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: currentStage.color }} />{currentStage.label}</span>
        </Fact>
        {job.dateReceived && <Fact label="Received">{job.dateReceived}</Fact>}
        {(job.priority === 'high' || job.priority === 'urgent') && <Fact label="Priority"><span className="uppercase text-red-400">{job.priority}</span></Fact>}
      </div>

      {/* Where it is */}
      <div className="flex items-center gap-1" aria-label={`Stage ${stageIdx + 1} of ${stages.length}: ${currentStage.label}`}>
        {stages.map((s, i) => (
          <div key={s.id} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className={`h-2 w-full rounded-full ${i === stageIdx ? 'ring-2 ring-white/40' : ''}`} style={{ background: i <= stageIdx ? s.color : '#27272a', opacity: i <= stageIdx ? 1 : 0.4 }} />
            <span className={`text-[9px] font-bold truncate max-w-full ${i === stageIdx ? 'text-white' : 'text-zinc-600'}`}>{s.label}</span>
          </div>
        ))}
      </div>

      {openRework > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-300 text-sm font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {openRework} open rework
        </div>
      )}

      {/* Instructions — what the floor must not miss */}
      {(job.specialInstructions || job.info) && (
        <Section icon={<StickyNote className="w-3.5 h-3.5" aria-hidden="true" />} title="Instructions">
          {job.specialInstructions && <p className="text-sm text-amber-200 whitespace-pre-wrap">{job.specialInstructions}</p>}
          {job.info && <p className={`text-sm text-zinc-300 whitespace-pre-wrap ${job.specialInstructions ? 'mt-2 pt-2 border-t border-white/5' : ''}`}>{job.info}</p>}
        </Section>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <Section icon={<CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />} title={`Steps · ${steps.filter(s => stepDone(job, s)).length} of ${steps.length} done`}>
          <ul className="space-y-1.5">
            {steps.map(s => {
              const done = stepDone(job, s);
              const by = stepTickedBy(job, s);
              return (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500 text-black' : 'border-2 border-zinc-600'}`}>{done && <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />}</span>
                  <span className={`flex-1 min-w-0 ${done ? 'text-zinc-400 line-through' : 'text-white font-semibold'}`}>{s.label}</span>
                  {done && by?.name && <span className="text-[11px] text-zinc-500 shrink-0">{by.name.split(' ')[0]}</span>}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* Time */}
      <Section icon={<Clock className="w-3.5 h-3.5" aria-hidden="true" />} title="Time">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-white tabular">{fmtMinutes(totalMins)}</span>
          {budgetMins > 0 && <span className={`text-sm font-bold ${totalMins > budgetMins ? 'text-red-400' : 'text-zinc-500'}`}>of {fmtMinutes(budgetMins)} budget</span>}
        </div>
        {budgetMins > 0 && (
          <div className="h-1.5 rounded-full bg-zinc-800 mt-2 overflow-hidden">
            <div className={`h-full rounded-full ${totalMins > budgetMins ? 'bg-red-500' : totalMins > budgetMins * 0.9 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, (totalMins / budgetMins) * 100)}%` }} />
          </div>
        )}
        {running.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {running.map(l => `${(l.userName || '').split(' ')[0]} on ${l.operation}`).join(' · ')}
          </p>
        )}
        {recent.length > 0 && (
          <ul className="mt-2 pt-2 border-t border-white/5 space-y-1">
            {recent.map(l => (
              <li key={l.id} className="flex items-center gap-2 text-xs">
                <Users className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden="true" />
                <span className="text-zinc-300 font-semibold truncate">{(l.userName || '').split(' ')[0]}</span>
                <span className="text-amber-400/80 truncate">{l.operation}</span>
                <span className="ml-auto shrink-0 text-zinc-500 font-mono">{new Date(l.startTime).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} · {fmtMinutes(logMinutes(l))}</span>
              </li>
            ))}
          </ul>
        )}
        {jobLogs.length === 0 && running.length === 0 && <p className="text-xs text-zinc-500 mt-1">No time logged yet.</p>}
      </Section>

      {/* Notes */}
      {notes.length > 0 && (
        <Section icon={<StickyNote className="w-3.5 h-3.5" aria-hidden="true" />} title={`Notes · ${notes.length}`}>
          <ul className="space-y-2">
            {notes.slice(0, 5).map(n => (
              <li key={n.id} className="text-sm">
                <p className="text-zinc-200 whitespace-pre-wrap">{n.text}</p>
                <p className="text-[11px] text-zinc-500">{n.userName} · {new Date(n.timestamp).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Files */}
      {(job.attachments?.length || 0) > 0 && (
        <Section icon={<Paperclip className="w-3.5 h-3.5" aria-hidden="true" />} title={`Files · ${job.attachments!.length}`}>
          <ul className="space-y-1.5">
            {job.attachments!.map(a => (
              <li key={a.id}>
                <a href={a.dataUrl} download={a.name} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200 font-semibold min-w-0">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{a.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Modal>
  );
};

export default JobView;
