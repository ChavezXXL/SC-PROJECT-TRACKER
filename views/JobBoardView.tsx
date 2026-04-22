// JobBoardView — Admin Kanban board for tracking jobs through workflow stages.
// Drag-and-drop between columns, filters by customer/priority/completed window,
// and per-card quick-advance. Extracted from App.tsx as part of the modularization
// effort. Pure move — zero functional changes.

import React, { useState, useEffect, useMemo } from 'react';
import { Columns3, Search, ArrowRight, GripVertical, Settings as SettingsIcon } from 'lucide-react';

import { Job, SystemSettings } from '../types';
import * as DB from '../services/mockDb';
import { dateNum, todayFmt } from '../utils/date';
import { getStages, getJobStage, getNextStage, useIsMobile } from '../App';

// --- ADMIN: JOB FLOW BOARD (Kanban) ---
export const JobBoardView = ({ user, addToast, confirm, onEditStages }: any) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shopSettings, setShopSettings] = useState<SystemSettings>(DB.getSettings());
  const [draggingJob, setDraggingJob] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [completedWindow, setCompletedWindow] = useState<'7' | '30' | '90' | 'all'>('7');
  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const isMobile = useIsMobile();

  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeSettings(setShopSettings);
    return () => { u1(); u2(); };
  }, []);

  const stages = getStages(shopSettings);
  const todayN = dateNum(todayFmt());
  const in3N = dateNum(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));

  // Unique customers for filter
  const customers = useMemo(() => {
    const set = new Set(jobs.map(j => j.customer).filter(Boolean) as string[]);
    return [...set].sort();
  }, [jobs]);

  // Completion window cutoff
  const completedCutoff = useMemo(() => {
    if (completedWindow === 'all') return 0;
    const days = parseInt(completedWindow, 10);
    return Date.now() - days * 86400000;
  }, [completedWindow]);

  // Filter jobs by search + customer + priority + completion-window
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter(j => {
      // Hide old completed jobs outside the window
      const st = getJobStage(j, stages);
      if (st.isComplete && completedCutoff > 0 && (j.completedAt || 0) < completedCutoff) return false;
      // Customer filter
      if (filterCustomer !== 'all' && j.customer !== filterCustomer) return false;
      // Priority filter
      if (filterPriority !== 'all' && (j.priority || 'normal') !== filterPriority) return false;
      // Search
      if (q && !(
        (j.poNumber || '').toLowerCase().includes(q) ||
        (j.partNumber || '').toLowerCase().includes(q) ||
        (j.customer || '').toLowerCase().includes(q) ||
        (j.jobIdsDisplay || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [jobs, search, stages, completedCutoff, filterCustomer, filterPriority]);

  // Bucket by stage
  const columnJobs = useMemo(() => {
    const map = new Map<string, Job[]>();
    stages.forEach(s => map.set(s.id, []));
    filtered.forEach(j => {
      const st = getJobStage(j, stages);
      if (!map.has(st.id)) map.set(st.id, []);
      map.get(st.id)!.push(j);
    });
    // Sort each column — earliest due in active, most-recent-first in completed
    map.forEach((list, stageId) => {
      const stage = stages.find(s => s.id === stageId);
      if (stage?.isComplete) {
        list.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      } else {
        list.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      }
    });
    return map;
  }, [filtered, stages]);

  const hiddenCompletedCount = useMemo(() => {
    if (completedWindow === 'all') return 0;
    return jobs.filter(j => {
      const st = getJobStage(j, stages);
      return st.isComplete && (j.completedAt || 0) < completedCutoff;
    }).length;
  }, [jobs, stages, completedCutoff, completedWindow]);

  const activeFilters = (filterCustomer !== 'all' ? 1 : 0) + (filterPriority !== 'all' ? 1 : 0);

  const moveJob = async (jobId: string, toStageId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const target = stages.find(s => s.id === toStageId);
    if (!target) return;
    const current = getJobStage(job, stages);
    if (current.id === target.id) return;
    try {
      await DB.advanceJobStage(jobId, target.id, user.id, user.name, !!target.isComplete);
      addToast('success', `${job.poNumber} → ${target.label}`);
    } catch {
      addToast('error', 'Failed to move job');
    }
  };

  const totalJobs = jobs.length;
  const wipJobs = jobs.filter(j => {
    const s = getJobStage(j, stages);
    return !s.isComplete;
  }).length;
  const overdueCount = jobs.filter(j => {
    const s = getJobStage(j, stages);
    return !s.isComplete && j.dueDate && dateNum(j.dueDate) < todayN;
  }).length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><Columns3 className="w-6 h-6 text-blue-500" aria-hidden="true" /> Job Flow Board</h2>
          <p className="text-zinc-500 text-sm mt-0.5">{wipJobs} in flight · {overdueCount} overdue · drag to advance</p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" aria-hidden="true" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search PO, part, customer…"
              className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none"
            />
          </div>
          {/* Edit Stages — jumps straight to Settings where columns live.
              Admins asked for a shortcut so they don't hunt through tabs. */}
          {onEditStages && (
            <button
              type="button"
              onClick={onEditStages}
              title="Add, rename, or remove board columns"
              className="shrink-0 bg-zinc-900/60 hover:bg-white/10 border border-white/10 hover:border-white/20 text-zinc-300 hover:text-white rounded-xl px-3 py-2 text-sm font-bold flex items-center gap-1.5 transition-colors"
            >
              <SettingsIcon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Edit Stages</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 bg-zinc-900/40 border border-white/5 rounded-2xl p-3">
        {/* Completed window */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mr-1">Completed</span>
          <div role="group" aria-label="Completed jobs window" className="inline-flex gap-1 p-1 bg-zinc-950/60 border border-white/5 rounded-lg">
            {(['7', '30', '90', 'all'] as const).map(w => (
              <button
                key={w}
                onClick={() => setCompletedWindow(w)}
                aria-pressed={completedWindow === w}
                className={`px-3 py-1.5 text-[11px] font-bold rounded transition-colors min-h-[32px] ${completedWindow === w ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
              >
                {w === 'all' ? 'All' : `${w}d`}
              </button>
            ))}
          </div>
        </div>

        {/* Customer filter */}
        {customers.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mr-1">Customer</span>
            <select
              aria-label="Filter by customer"
              value={filterCustomer}
              onChange={e => setFilterCustomer(e.target.value)}
              className="bg-zinc-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none hover:border-white/20 cursor-pointer max-w-[180px] min-h-[32px]"
            >
              <option value="all">All customers</option>
              {customers.map(c => <option key={c} value={c}>{c.length > 24 ? c.slice(0, 23) + '…' : c}</option>)}
            </select>
          </div>
        )}

        {/* Priority filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mr-1">Priority</span>
          <div role="group" aria-label="Priority filter" className="inline-flex gap-1 p-1 bg-zinc-950/60 border border-white/5 rounded-lg">
            {(['all', 'urgent', 'high', 'normal'] as const).map(p => (
              <button
                key={p}
                onClick={() => setFilterPriority(p)}
                aria-pressed={filterPriority === p}
                className={`px-3 py-1.5 text-[11px] font-bold rounded transition-colors capitalize min-h-[32px] ${filterPriority === p ? (p === 'urgent' ? 'bg-red-600 text-white' : p === 'high' ? 'bg-orange-600 text-white' : 'bg-blue-600 text-white') : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Reset */}
        {(activeFilters > 0 || completedWindow !== '7' || search) && (
          <button
            onClick={() => { setFilterCustomer('all'); setFilterPriority('all'); setCompletedWindow('7'); setSearch(''); }}
            className="text-[11px] text-zinc-400 hover:text-white font-semibold px-2 py-1 rounded hover:bg-white/5"
          >
            Reset
          </button>
        )}

        {/* Hidden indicator */}
        {hiddenCompletedCount > 0 && (
          <span className="ml-auto text-[10px] text-zinc-600 italic">
            {hiddenCompletedCount} completed older than {completedWindow}d hidden
          </span>
        )}
      </div>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollSnapType: isMobile ? 'x mandatory' : 'none' }}>
        {stages.map(stage => {
          const list = columnJobs.get(stage.id) || [];
          const isHover = hoverStage === stage.id;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { e.preventDefault(); setHoverStage(stage.id); }}
              onDragLeave={() => setHoverStage(prev => prev === stage.id ? null : prev)}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/jobId');
                setHoverStage(null);
                setDraggingJob(null);
                if (id) moveJob(id, stage.id);
              }}
              className={`shrink-0 w-[280px] sm:w-[300px] rounded-2xl border flex flex-col max-h-[calc(100vh-200px)] transition-all ${isHover ? 'bg-white/[0.04] border-blue-500/40 ring-1 ring-blue-500/30' : 'bg-zinc-900/40 border-white/5'}`}
              style={{ scrollSnapAlign: isMobile ? 'start' : undefined }}
            >
              {/* Column header */}
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between gap-2 sticky top-0 bg-zinc-900/80 backdrop-blur-xl rounded-t-2xl">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color, boxShadow: `0 0 8px ${stage.color}80` }} />
                  <span className="text-[13px] font-black text-white uppercase tracking-wide truncate">{stage.label}</span>
                </div>
                <span className="text-[11px] font-mono font-bold tabular px-2 py-0.5 rounded-full border shrink-0" style={{ background: `${stage.color}15`, color: stage.color, borderColor: `${stage.color}30` }}>
                  {list.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {list.length === 0 && (
                  <div className="py-8 text-center text-zinc-700 text-xs">
                    <div className="opacity-40 mb-1">—</div>
                    No jobs here
                  </div>
                )}
                {list.map(j => {
                  const isOverdue = !stage.isComplete && j.dueDate && dateNum(j.dueDate) < todayN;
                  const isDueSoon = !stage.isComplete && !isOverdue && j.dueDate && dateNum(j.dueDate) >= todayN && dateNum(j.dueDate) <= in3N;
                  const next = getNextStage(j, stages);
                  return (
                    <div
                      key={j.id}
                      draggable
                      onDragStart={(e) => { setDraggingJob(j.id); e.dataTransfer.setData('text/jobId', j.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDraggingJob(null); setHoverStage(null); }}
                      className={`group bg-zinc-950/60 border rounded-xl p-3 cursor-grab active:cursor-grabbing transition-all hover:border-white/15 relative ${draggingJob === j.id ? 'opacity-40 scale-95' : ''} ${isOverdue ? 'border-red-500/30' : isDueSoon ? 'border-orange-500/25' : 'border-white/5'}`}
                      style={isOverdue ? { boxShadow: '0 0 0 1px rgba(239,68,68,0.2), 0 4px 12px -4px rgba(239,68,68,0.2)' } : undefined}
                    >
                      {/* Drag handle */}
                      <div aria-hidden="true" className="absolute top-2 right-2 opacity-0 group-hover:opacity-50 transition-opacity">
                        <GripVertical className="w-3 h-3 text-zinc-500" />
                      </div>

                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="font-black text-white text-sm tabular truncate">{j.poNumber}</p>
                        {isOverdue && <span className="text-[9px] font-black text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded shrink-0">LATE</span>}
                        {isDueSoon && <span className="text-[9px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded shrink-0">SOON</span>}
                      </div>

                      <p className="text-[11px] text-zinc-400 font-semibold truncate mb-0.5">{j.partNumber}</p>
                      {j.customer && <p className="text-[10px] text-zinc-600 truncate">{j.customer}</p>}

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 gap-2">
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 min-w-0">
                          <span className="font-mono font-bold">{j.quantity || '—'}</span>
                          <span>×</span>
                          {j.dueDate ? (
                            <span className={`font-mono font-bold tabular ${isOverdue ? 'text-red-400' : isDueSoon ? 'text-orange-400' : 'text-zinc-400'}`}>{j.dueDate.slice(5)}</span>
                          ) : <span className="text-zinc-700">no due</span>}
                        </div>
                        {next && (
                          <button
                            aria-label={`Advance ${j.poNumber} to ${next.label}`}
                            onClick={() => confirm ? confirm({ title: `Advance to ${next.label}?`, message: `Move ${j.poNumber} forward?`, onConfirm: () => moveJob(j.id, next.id) }) : moveJob(j.id, next.id)}
                            className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
                            style={{ color: next.color, background: `${next.color}15`, border: `1px solid ${next.color}30` }}
                            title={`Move to ${next.label}`}
                          >
                            Next <ArrowRight className="w-3 h-3" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="card-shine hover-lift-glow bg-zinc-900/50 border border-white/5 rounded-2xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="text-center">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Total</p>
          <p className="text-xl font-black text-white tabular mt-0.5">{totalJobs}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">In Flight</p>
          <p className="text-xl font-black text-blue-400 tabular mt-0.5">{wipJobs}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Completed</p>
          <p className="text-xl font-black text-emerald-400 tabular mt-0.5">{totalJobs - wipJobs}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Overdue</p>
          <p className={`text-xl font-black tabular mt-0.5 ${overdueCount > 0 ? 'text-red-400' : 'text-zinc-600'}`}>{overdueCount}</p>
        </div>
      </div>
    </div>
  );
};
