import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink, RefreshCw, Calculator, Activity,
  Play
} from 'lucide-react';
import { Toast } from './components/Toast';
import { Job, User, TimeLog, ToastMessage, AppView, SystemSettings } from './types';
import * as DB from './services/mockDb';
import { parseJobDetails } from './services/geminiService';

// --- UTILS ---
const formatDuration = (mins: number | undefined | null) => {
  if (mins === undefined || mins === null) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const toDateTimeLocal = (ts: number | undefined | null) => {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PrintStyles = () => (
  <style>{`
    @media print {
      body * { visibility: hidden !important; }
      #printable-area-root, #printable-area-root * { visibility: visible !important; }
      #printable-area-root {
        position: absolute !important;
        left: 0 !important; top: 0 !important;
        width: 100% !important; height: auto !important;
        background: white !important; z-index: 9999999 !important;
        color: black !important; display: block !important;
      }
      .no-print { display: none !important; }
      @page { size: portrait; margin: 10mm; }
    }
  `}</style>
);

// --- COMPONENT: LIVE TIMER ---
const LiveTimer = ({ startTime }: { startTime: number }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(i);
  }, [startTime]);
  const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
  return <div className="font-mono tabular-nums">{h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}</div>;
};

// --- COMPONENT: ACTIVE JOB PANEL ---
const ActiveJobPanel = ({ job, log, onStop }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void> }) => {
  const [isStopping, setIsStopping] = useState(false);
  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try { await onStop(log.id); } catch (e) { setIsStopping(false); }
  };
  return (
    <div className="bg-zinc-900 border border-blue-500/30 rounded-[40px] p-8 md:p-10 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 via-purple-500 to-blue-600 opacity-50 animate-pulse"></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 relative z-10">
        <div className="flex flex-col justify-center">
           <div className="flex items-center gap-2 mb-4">
              <span className="animate-pulse w-3 h-3 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]"></span>
              <span className="text-red-400 font-black uppercase tracking-[0.2em] text-[10px] md:text-xs">Live Terminal</span>
           </div>
           <h2 className="text-4xl md:text-7xl font-black text-white mb-2 tracking-tighter leading-none">{job ? job.jobIdsDisplay : 'UNKNOWN_BATCH'}</h2>
           <div className="text-xl md:text-3xl text-blue-400 font-black mb-8"><span className="px-5 py-1.5 bg-blue-500/10 rounded-2xl border border-blue-500/20">{log.operation}</span></div>
           <div className="bg-black/60 rounded-3xl p-6 md:p-8 border border-white/10 mb-8 w-full max-w-md flex items-center justify-between shadow-inner">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.3em] mb-2 opacity-60">Cycle Duration</p>
                <div className="text-white text-4xl md:text-6xl font-black tracking-widest leading-none"><LiveTimer startTime={log.startTime} /></div>
              </div>
              <Clock className="w-12 h-12 text-zinc-800" />
           </div>
           <button onClick={handleStop} disabled={isStopping} className="w-full max-w-md bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-8 py-5 rounded-[24px] font-black uppercase tracking-[0.4em] text-sm md:text-base flex items-center justify-center gap-4 shadow-2xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
              {isStopping ? 'TERMINATING...' : <><StopCircle className="w-6 h-6" /> END SESSION</>}
           </button>
        </div>
        <div className="bg-white/[0.03] rounded-[32px] p-6 md:p-10 border border-white/5 flex flex-col h-full backdrop-blur-xl shadow-inner relative">
           <h3 className="text-zinc-500 font-black uppercase text-[10px] mb-8 flex items-center gap-3 tracking-[0.3em]"><Info className="w-4 h-4 text-blue-500" /> Batch Specifications</h3>
           {job ? (
             <div className="grid grid-cols-2 gap-y-10 gap-x-8">
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Part Index</label><div className="text-xl md:text-3xl font-black text-white mt-2 break-words leading-none tracking-tight">{job.partNumber}</div></div>
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Order Ref</label><div className="text-xl md:text-3xl font-black text-white mt-2 break-words leading-none tracking-tight">{job.poNumber}</div></div>
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Lot Size</label><div className="text-xl md:text-3xl font-black text-blue-500 mt-2 leading-none">{job.quantity} <span className="text-xs font-bold text-zinc-600 ml-1">PCS</span></div></div>
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Deadline</label><div className="text-xl md:text-3xl font-black text-red-500 mt-2 leading-none">{job.dueDate || 'N/A'}</div></div>
             </div>
           ) : <p className="text-zinc-500 font-black uppercase tracking-widest">NO_DATA</p>}
        </div>
      </div>
    </div>
  );
};

// --- HELPER COMPONENT: JOB CARD (EMPLOYEE) ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`bg-zinc-900/40 border border-white/10 rounded-3xl overflow-hidden transition-all duration-500 ${expanded ? 'ring-2 ring-blue-500/50 bg-zinc-800 shadow-2xl scale-[1.02]' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
      <div className="p-6 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex justify-between items-start mb-4 gap-4">
          <h3 className="text-xl font-black text-white truncate tracking-tighter leading-none uppercase">{job.jobIdsDisplay}</h3>
          <span className="bg-zinc-950 text-blue-500 text-[10px] px-3 py-1 rounded-full font-black border border-blue-500/20">{job.quantity} PCS</span>
        </div>
        <div className="text-[11px] text-zinc-500 space-y-2 font-black uppercase tracking-widest">
          <p className="truncate">Part: <span className="text-white">{job.partNumber}</span></p>
          <p className="truncate">PO: <span className="text-zinc-300">{job.poNumber}</span></p>
        </div>
        {!expanded && <div className="mt-6 flex items-center text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] border-t border-white/5 pt-4">SELECT PHASE <ArrowRight className="w-4 h-4 ml-auto" /></div>}
      </div>
      {expanded && (
        <div className="p-5 bg-zinc-950/60 border-t border-white/10 animate-fade-in shadow-inner">
          <div className="grid grid-cols-2 gap-3">
            {operations.map(op => <button key={op} onClick={(e) => { e.stopPropagation(); onStart(job.id, op); }} className="bg-zinc-900 hover:bg-blue-600 hover:text-white border border-white/5 py-4 px-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all text-zinc-400 shadow-xl">{op}</button>)}
          </div>
        </div>
      )}
    </div>
  );
};

// --- EMPLOYEE DASHBOARD ---
const EmployeeDashboard = ({ user, addToast, onLogout }: any) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);
  const [ops, setOps] = useState<string[]>([]);

  useEffect(() => {
    setOps(DB.getSettings().customOperations || []);
    const unsubLogs = DB.subscribeLogs((all) => {
       const myActive = all.find(l => l.userId === user.id && !l.endTime);
       setActiveLog(myActive || null);
       setMyHistory(all.filter(l => l.userId === user.id).sort((a,b) => b.startTime - a.startTime));
       if (myActive) DB.getJobById(myActive.jobId).then(j => setActiveJob(j || null));
       else setActiveJob(null);
    });
    const unsubJobs = DB.subscribeJobs((all) => setJobs(all.filter(j => j.status !== 'completed').reverse()));
    return () => { unsubLogs(); unsubJobs(); };
  }, [user.id]);

  const filteredJobs = jobs.filter(j => JSON.stringify(j).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-24">
      {activeLog && <ActiveJobPanel job={activeJob} log={activeLog} onStop={DB.stopTimeLog} />}
      <div className="flex justify-between items-center bg-zinc-900/60 backdrop-blur-2xl p-3 rounded-[32px] border border-white/10 sticky top-6 z-30 shadow-2xl">
         <div className="flex gap-2">
           <button onClick={() => setTab('jobs')} className={`px-6 py-3 rounded-[20px] text-[10px] font-black uppercase tracking-[0.2em] transition-all ${tab === 'jobs' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-500 hover:text-white'}`}>Batches</button>
           <button onClick={() => setTab('history')} className={`px-6 py-3 rounded-[20px] text-[10px] font-black uppercase tracking-[0.2em] transition-all ${tab === 'history' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-500 hover:text-white'}`}>Logs</button>
         </div>
         <div className="flex gap-3">
             <button onClick={() => setTab('scan')} className={`p-3 rounded-[20px] transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow-xl' : 'bg-zinc-800 text-blue-500'}`}><ScanLine className="w-6 h-6" /></button>
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 p-3 rounded-[20px] hover:bg-red-600 transition-all shadow-xl"><LogOut className="w-6 h-6" /></button>
         </div>
      </div>
      {tab === 'scan' ? (
         <div className="py-20 animate-fade-in flex justify-center">
            <div className="bg-zinc-900/60 p-12 rounded-[64px] border border-white/10 text-center max-w-md w-full shadow-2xl backdrop-blur-xl">
               <QrCode className="w-16 h-16 text-blue-500 animate-pulse mx-auto mb-10" />
               <input autoFocus onKeyDown={(e) => { if(e.key === 'Enter') { setSearch(e.currentTarget.value); setTab('jobs'); e.currentTarget.value = ''; } }} className="bg-black/60 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white text-center w-full text-xl font-black outline-none tracking-widest placeholder-zinc-800" placeholder="SCAN_READY" />
            </div>
         </div>
      ) : (
        <div className="animate-fade-in space-y-8">
          <div className="relative group">
            <Search className="absolute left-6 top-5 w-6 h-6 text-zinc-700" />
            <input type="text" placeholder="FILTER PIPELINE..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/5 rounded-[32px] pl-16 pr-8 py-5 text-white font-black uppercase tracking-[0.3em] text-xs focus:ring-4 focus:ring-blue-600/10 outline-none shadow-2xl"/>
          </div>
          {tab === 'history' ? (
             <div className="bg-zinc-900/40 border border-white/10 rounded-[40px] overflow-hidden shadow-2xl backdrop-blur-xl">
                <table className="w-full text-left">
                  <thead className="bg-zinc-950/80 text-zinc-600 font-black uppercase tracking-[0.3em] text-[10px]"><tr><th className="p-6">Date</th><th className="p-6">Batch</th><th className="p-6">Phase</th><th className="p-6">Time</th></tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {myHistory.map(log => (
                      <tr key={log.id} className="hover:bg-white/[0.03] transition-colors"><td className="p-6 text-zinc-500 font-black text-xs">{new Date(log.startTime).toLocaleDateString()}</td><td className="p-6 text-white font-black uppercase">{log.jobId}</td><td className="p-6 text-zinc-400 font-black text-[10px]">{log.operation}</td><td className="p-6 text-blue-500 font-black font-mono text-lg">{formatDuration(log.durationMinutes)}</td></tr>
                    ))}
                  </tbody>
                </table>
             </div>
          ) : (
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
               {filteredJobs.map(job => <JobSelectionCard key={job.id} job={job} onStart={DB.startTimeLog} disabled={!!activeLog} operations={ops} />)}
             </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- CONFIRM MODAL ---
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[48px] p-10 shadow-2xl text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-[32px] flex items-center justify-center mx-auto mb-8 border border-red-500/20"><AlertTriangle className="text-red-500 w-10 h-10" /></div>
        <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-tight">{title}</h3>
        <p className="text-zinc-500 text-xs font-black uppercase tracking-widest mb-10 leading-relaxed opacity-60">{message}</p>
        <div className="grid grid-cols-2 gap-4"><button onClick={onCancel} className="bg-zinc-800 text-zinc-500 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:text-white transition-all">Abort</button><button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl shadow-red-900/40 hover:bg-red-500 transition-all">Confirm</button></div>
      </div>
    </div>
  );
};

// --- ADMIN: JOBS (CATEGORIZED & FILTERABLE) ---
const JobsView = ({ addToast, setPrintable, confirm }: any) => {
   const [jobs, setJobs] = useState<Job[]>([]);
   const [subTab, setSubTab] = useState<'active' | 'archive'>('active');
   const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year' | 'all'>('week');
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [isSaving, setIsSaving] = useState(false);
   const [search, setSearch] = useState('');

   useEffect(() => DB.subscribeJobs(setJobs), []);

   const filteredJobs = useMemo(() => {
       const term = search.toLowerCase();
       const now = Date.now();
       return jobs.filter(j => {
           if (!JSON.stringify(j).toLowerCase().includes(term)) return false;
           if (subTab === 'active') return j.status !== 'completed';
           if (j.status !== 'completed') return false;
           if (timeFilter === 'all') return true;
           const diff = now - (j.completedAt || j.createdAt);
           if (timeFilter === 'week') return diff <= 7 * 24 * 60 * 60 * 1000;
           if (timeFilter === 'month') return diff <= 30 * 24 * 60 * 60 * 1000;
           if (timeFilter === 'year') return diff <= 365 * 24 * 60 * 60 * 1000;
           return true;
       }).sort((a,b) => b.createdAt - a.createdAt);
   }, [jobs, search, subTab, timeFilter]);

   const handleSave = async () => {
    if (!editingJob.jobIdsDisplay || !editingJob.partNumber) return addToast('error', 'FIELDS_REQUIRED');
    setIsSaving(true);
    await DB.saveJob({ id: editingJob.id || Date.now().toString(), jobIdsDisplay: editingJob.jobIdsDisplay, poNumber: editingJob.poNumber || '', partNumber: editingJob.partNumber, quantity: editingJob.quantity || 0, dueDate: editingJob.dueDate || '', info: editingJob.info || '', status: editingJob.status || 'pending', dateReceived: editingJob.dateReceived || new Date().toISOString().split('T')[0], createdAt: editingJob.createdAt || Date.now() } as Job);
    addToast('success', 'BATCH_SAVED'); setShowModal(false); setIsSaving(false);
   };

   return (
      <div className="space-y-8 animate-fade-in">
         <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-8">
            <div>
               <h2 className="text-5xl font-black uppercase tracking-tighter text-white leading-none mb-4">Floor Pipeline</h2>
               <div className="flex gap-4 p-1.5 bg-zinc-900/60 border border-white/5 rounded-2xl w-fit backdrop-blur-xl">
                  <button onClick={() => setSubTab('active')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${subTab === 'active' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Active Production</button>
                  <button onClick={() => setSubTab('archive')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${subTab === 'archive' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Archived Records</button>
               </div>
            </div>
            <div className="flex gap-4 flex-wrap lg:justify-end items-center">
                {subTab === 'archive' && (
                    <div className="flex gap-2 p-1 bg-black/40 border border-white/5 rounded-xl mr-2">
                        {['week', 'month', 'year', 'all'].map(t => <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${timeFilter === t ? 'bg-zinc-800 text-blue-400' : 'text-zinc-600 hover:text-zinc-400'}`}>{t}</button>)}
                    </div>
                )}
                <div className="relative flex-1 lg:flex-initial shadow-2xl">
                    <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-700" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="FILTER PO / JOB..." className="pl-14 pr-6 py-4 bg-zinc-900 border border-white/5 rounded-[24px] text-[10px] font-black uppercase tracking-[0.3em] text-white w-full lg:w-80 focus:ring-4 focus:ring-blue-600/10 outline-none backdrop-blur-xl transition-all" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-8 py-4 rounded-[24px] text-[10px] font-black uppercase tracking-[0.4em] text-white flex items-center gap-3 hover:bg-blue-500 shadow-2xl transition-all active:scale-95"><Plus className="w-5 h-5"/> New Batch</button>
            </div>
         </div>
         <div className="grid grid-cols-1 gap-6">
            {filteredJobs.map(j => (
               <div key={j.id} className="bg-zinc-900/40 border border-white/10 rounded-[40px] p-8 md:p-10 flex flex-col md:flex-row justify-between items-center group shadow-2xl transition-all hover:bg-zinc-900/60">
                  <div className="flex-1 w-full space-y-4">
                     <div className="flex items-center gap-4">
                        <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${j.status === 'in-progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>{j.status}</span>
                        <span className="text-zinc-600 font-black text-[10px] uppercase tracking-widest">Sequence: {j.jobIdsDisplay}</span>
                     </div>
                     <h3 className="text-4xl md:text-5xl font-black text-white leading-none tracking-tighter break-all">{j.poNumber}</h3>
                     <div className="flex flex-wrap gap-8">
                        <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Part Index</p><p className="text-lg font-bold text-zinc-400">{j.partNumber}</p></div>
                        <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Quantity</p><p className="text-2xl font-black text-blue-500">{j.quantity} PCS</p></div>
                        <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Due Date</p><p className="text-lg font-bold text-red-600">{j.dueDate || 'PRIORITY'}</p></div>
                     </div>
                  </div>
                  <div className="flex gap-3 mt-8 md:mt-0 opacity-40 group-hover:opacity-100 transition-all">
                     {j.status !== 'completed' ? (
                        <button onClick={() => confirm({ title: "Finalize Batch", message: "Archive production?", onConfirm: () => DB.completeJob(j.id) })} className="p-4 bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all"><CheckCircle className="w-6 h-6"/></button>
                     ) : (
                        <button onClick={() => confirm({ title: "Reopen", message: "Back to floor?", onConfirm: () => DB.reopenJob(j.id) })} className="p-4 bg-blue-500/10 text-blue-500 rounded-2xl hover:bg-blue-500 hover:text-white transition-all"><RotateCcw className="w-6 h-6"/></button>
                     )}
                     <button onClick={() => setPrintable(j)} className="p-4 bg-zinc-800 text-zinc-500 rounded-2xl hover:bg-zinc-700 hover:text-white transition-all"><Printer className="w-6 h-6"/></button>
                     <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-4 bg-blue-500/10 text-blue-400 rounded-2xl hover:bg-blue-500 hover:text-white transition-all"><Edit2 className="w-6 h-6"/></button>
                     <button onClick={() => confirm({ title: "Destroy", message: "Delete record?", onConfirm: () => DB.deleteJob(j.id) })} className="p-4 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-600 hover:text-white transition-all"><Trash2 className="w-6 h-6"/></button>
                  </div>
               </div>
            ))}
            {filteredJobs.length === 0 && <div className="py-24 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.5em] opacity-40">Pipeline clear</div>}
         </div>

         {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
               <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-[64px] shadow-2xl p-10">
                  <div className="flex justify-between items-center mb-10"><h3 className="font-black text-white uppercase text-2xl tracking-tight leading-none">Job Matrix Spec</h3><button onClick={() => setShowModal(false)} className="p-4 bg-white/5 rounded-2xl text-zinc-600 hover:text-white"><X className="w-6 h-6" /></button></div>
                  <div className="space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
                     <div className="space-y-2"><label className="text-[10px] text-blue-500 font-black uppercase tracking-[0.3em]">Purchase Order #</label><input className="w-full bg-black/60 border-2 border-white/5 rounded-[24px] p-6 text-white text-3xl font-black outline-none tracking-tight uppercase focus:border-blue-600 transition-all" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} /></div>
                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em]">Job Index</label><input className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-white font-black uppercase" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em]">Part #</label><input className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-white font-black uppercase" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
                     </div>
                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em]">Quantity</label><input type="number" className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-white font-black" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em]">Target Date</label><input type="date" className="w-full bg-zinc-800 border border-white/5 rounded-2xl p-4 text-white text-xs font-black uppercase" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
                     </div>
                     <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em]">Instructions</label><textarea className="w-full bg-black/30 border border-white/5 rounded-[32px] p-6 text-xs text-zinc-400 italic" rows={4} value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
                  </div>
                  <div className="mt-10 flex justify-end gap-5"><button onClick={() => setShowModal(false)} className="text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em]">Discard</button><button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95">{isSaving ? 'SYNCING...' : 'COMMIT_DATA'}</button></div>
               </div>
            </div>
         )}
      </div>
   );
};

// --- ADMIN: LOGS (GROUPED BY JOB BOXES) ---
const LogsView = ({ addToast }: { addToast: any }) => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
   const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year' | 'all'>('week');
   const [search, setSearch] = useState('');

   useEffect(() => {
     const u1 = DB.subscribeLogs(setLogs);
     const u2 = DB.subscribeJobs(setJobs);
     return () => { u1(); u2(); };
   }, []);

   const groupedLogs = useMemo(() => {
     const now = Date.now();
     const filtered = logs.filter(l => {
        if (search && !JSON.stringify(l).toLowerCase().includes(search.toLowerCase())) return false;
        if (timeFilter === 'all') return true;
        const diff = now - l.startTime;
        if (timeFilter === 'week') return diff <= 7 * 24 * 60 * 60 * 1000;
        if (timeFilter === 'month') return diff <= 30 * 24 * 60 * 60 * 1000;
        if (timeFilter === 'year') return diff <= 365 * 24 * 60 * 60 * 1000;
        return true;
     });

     const groups: Record<string, { job: Job | null, logs: TimeLog[], totalMins: number }> = {};
     filtered.forEach(log => {
        if (!groups[log.jobId]) {
           groups[log.jobId] = { job: jobs.find(j => j.id === log.jobId) || null, logs: [], totalMins: 0 };
        }
        groups[log.jobId].logs.push(log);
        if (log.durationMinutes) groups[log.jobId].totalMins += log.durationMinutes;
     });
     return Object.entries(groups).sort((a,b) => (b[1].logs[0]?.startTime || 0) - (a[1].logs[0]?.startTime || 0));
   }, [logs, jobs, timeFilter, search]);

   const handleSaveLog = async () => {
       if (editingLog) { await DB.updateTimeLog(editingLog); addToast('success', 'RECORD_UPDATED'); setEditingLog(null); }
   };

   return (
      <div className="space-y-10 animate-fade-in">
         <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-8">
            <div>
               <h2 className="text-5xl font-black uppercase tracking-tighter text-white leading-none mb-4">Production Logs</h2>
               <div className="flex gap-4 p-1.5 bg-zinc-900/60 border border-white/5 rounded-2xl w-fit backdrop-blur-xl">
                  {['week', 'month', 'year', 'all'].map(t => <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.3em] transition-all ${timeFilter === t ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>{t}</button>)}
               </div>
            </div>
            <div className="relative flex-1 lg:flex-initial shadow-2xl">
                <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-700" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="FILTER ARCHIVE..." className="pl-14 pr-6 py-4 bg-zinc-900 border border-white/5 rounded-[24px] text-[10px] font-black uppercase tracking-[0.3em] text-white w-full lg:w-80 outline-none backdrop-blur-xl" />
            </div>
         </div>

         <div className="space-y-8">
            {groupedLogs.map(([jobId, data]) => (
               <div key={jobId} className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden shadow-2xl backdrop-blur-xl group">
                  <div className="p-8 md:p-10 border-b border-white/5 bg-zinc-950/40 flex flex-col md:flex-row justify-between items-center gap-6">
                     <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2"><span className="text-[10px] font-black text-blue-500 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">JOB_RECORD</span><span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">ID: {jobId}</span></div>
                        <h3 className="text-3xl font-black text-white uppercase tracking-tighter break-all">{data.job?.poNumber || 'UNKNOWN_PO'}</h3>
                        <p className="text-sm font-bold text-zinc-500 mt-1 uppercase tracking-widest">{data.job?.partNumber || 'N/A'}</p>
                     </div>
                     <div className="text-right flex flex-col items-center md:items-end">
                        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] mb-1">Total Floor Time</p>
                        <div className="text-4xl font-black text-white font-mono leading-none tracking-widest">{formatDuration(data.totalMins)}</div>
                     </div>
                  </div>
                  <div className="overflow-x-auto">
                     <table className="w-full text-left">
                        <thead className="bg-white/5 text-zinc-600 font-black uppercase tracking-[0.3em] text-[10px]"><tr><th className="p-6">Date</th><th className="p-6">Operator</th><th className="p-6">Phase</th><th className="p-6">Time Span</th><th className="p-6">Duration</th><th className="p-6 text-right">Edit</th></tr></thead>
                        <tbody className="divide-y divide-white/5">
                           {data.logs.map(l => (
                              <tr key={l.id} className="hover:bg-white/[0.02] transition-colors">
                                 <td className="p-6 text-zinc-500 font-black text-xs uppercase">{new Date(l.startTime).toLocaleDateString()}</td>
                                 <td className="p-6 text-white font-black uppercase tracking-tight text-sm">{l.userName}</td>
                                 <td className="p-6 text-blue-500 font-black uppercase text-[10px] tracking-widest">{l.operation}</td>
                                 <td className="p-6 font-mono text-zinc-400 text-xs">
                                    {new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 
                                    {l.endTime ? ` - ${new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : ' - PRESENT'}
                                 </td>
                                 <td className="p-6 text-zinc-300 font-black font-mono text-sm uppercase">{formatDuration(l.durationMinutes)}</td>
                                 <td className="p-6 text-right"><button onClick={() => setEditingLog({...l})} className="p-3 bg-zinc-800 rounded-2xl text-zinc-600 hover:text-white transition-all"><Edit2 className="w-4 h-4"/></button></td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>
            ))}
            {groupedLogs.length === 0 && <div className="py-24 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.5em] opacity-40">Archive empty</div>}
         </div>

         {editingLog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
               <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-[64px] shadow-2xl p-10">
                  <div className="flex justify-between items-center mb-10"><h3 className="font-black text-white uppercase text-xl tracking-tight">Modify Log Entry</h3><button onClick={() => setEditingLog(null)} className="p-4 bg-white/5 rounded-2xl text-zinc-600 hover:text-white"><X className="w-6 h-6" /></button></div>
                  <div className="space-y-6">
                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 uppercase font-black tracking-[0.3em]">Phase Start</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-2xl p-4 text-white text-xs font-black uppercase tracking-widest" value={toDateTimeLocal(editingLog.startTime)} onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})} /></div>
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 uppercase font-black tracking-[0.3em]">Phase End</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-2xl p-4 text-white text-xs font-black uppercase tracking-widest" value={toDateTimeLocal(editingLog.endTime)} onChange={e => setEditingLog({...editingLog, endTime: e.target.value ? new Date(e.target.value).getTime() : null})} /></div>
                     </div>
                  </div>
                  <div className="mt-10 flex justify-end gap-5"><button onClick={() => setEditingLog(null)} className="text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em]">Abort</button><button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95">Sync Archive</button></div>
               </div>
            </div>
         )}
      </div>
   )
}

// --- ADMIN: EMPLOYEES ---
const AdminEmployees = ({ addToast, confirm }: any) => {
   const [users, setUsers] = useState<User[]>([]);
   const [editingUser, setEditingUser] = useState<Partial<User>>({});
   const [showModal, setShowModal] = useState(false);
   useEffect(() => DB.subscribeUsers(setUsers), []);
   const handleSave = () => {
     if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'FIELDS_REQUIRED');
     DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true });
     setShowModal(false); addToast('success', 'IDENTITY_SYNCED');
   };
   return (
     <div className="space-y-10 animate-fade-in">
        <div className="flex justify-between items-center"><h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">Global Personnel</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-[24px] flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95"><Plus className="w-5 h-5" /> Recruit Talent</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {users.map(u => (
            <div key={u.id} className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex items-center justify-between shadow-2xl backdrop-blur-xl group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-[24px] bg-zinc-800 flex items-center justify-center text-zinc-500 font-black border border-white/10 text-xl shadow-inner group-hover:text-blue-500 uppercase">{u.name.charAt(0)}</div>
                <div><p className="font-black text-white text-xl tracking-tight leading-none mb-1.5 uppercase">{u.name}</p><p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">@{u.username} • {u.role}</p></div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => confirm({ title: "Purge", message: "Erase identity?", onConfirm: () => DB.deleteUser(u.id) })} className="p-4 hover:bg-red-500/10 text-zinc-700 hover:text-red-500 transition-all rounded-2xl"><Trash2 className="w-5 h-5" /></button>
                 <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-4 hover:bg-white/5 text-zinc-600 hover:text-white transition-all rounded-2xl"><Edit2 className="w-5 h-5" /></button>
              </div>
            </div>
          ))}
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4">
             <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[56px] shadow-2xl p-10">
                <div className="flex justify-between items-center mb-10 leading-none"><h3 className="font-bold text-white text-xl uppercase tracking-tight">Profile Data</h3><button onClick={() => setShowModal(false)} className="p-3 bg-white/5 rounded-2xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button></div>
                <div className="space-y-6">
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Legal Name</label><input className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all uppercase" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Handle</label><input className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">PIN</label><input type="text" className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all tracking-[0.5em]" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Privilege</label><select className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold outline-none" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
                </div>
                <div className="p-10 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-3 mt-8"><button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-widest">Abort</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-[20px] text-[10px] font-black uppercase tracking-[0.3em] transition-all active:scale-95">Save Identity</button></div>
             </div>
          </div>
        )}
     </div>
   );
};

// --- ADMIN: SETTINGS ---
const SettingsView = ({ addToast }: { addToast: any }) => {
   const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
   const [newOp, setNewOp] = useState('');
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'CORE_PROTOCOL_UPDATED'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   const handleDeleteOp = (op: string) => { setSettings({...settings, customOperations: (settings.customOperations || []).filter(o => o !== op)}); };
   return (
     <div className="max-w-2xl space-y-12 animate-fade-in">
        <h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">System Protocols</h2>
        <div className="bg-zinc-900/40 border border-white/10 rounded-[56px] p-10 md:p-12 space-y-12 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-6 border-b border-white/10 pb-12"><div className="bg-blue-600/10 p-5 rounded-[32px] text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)] border border-blue-500/20"><Activity className="w-10 h-10" /></div><div><h3 className="font-black text-white uppercase text-xl tracking-tight">Phase Definitions</h3><p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-2">Workflow Phase Controls</p></div></div>
            <div className="space-y-8">
                <div className="flex gap-4"><input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="Register new production phase..." className="flex-1 bg-black/50 border border-white/5 rounded-[24px] px-8 py-5 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all" onKeyDown={e => e.key === 'Enter' && handleAddOp()} /><button onClick={handleAddOp} className="bg-blue-600 px-8 rounded-[24px] text-white font-black hover:bg-blue-500 transition-all active:scale-95 shadow-2xl"><Plus className="w-8 h-8" /></button></div>
                <div className="flex flex-wrap gap-4">{(settings.customOperations || []).map(op => <div key={op} className="bg-zinc-950 border border-white/5 px-5 py-3 rounded-2xl flex items-center gap-4 group hover:border-blue-500/50 transition-all shadow-inner"><span className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400 group-hover:text-white transition-colors">{op}</span><button onClick={() => handleDeleteOp(op)} className="text-zinc-800 hover:text-red-500 transition-colors"><X className="w-5 h-5" /></button></div>)}</div>
            </div>
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-14 py-6 rounded-[32px] font-black uppercase tracking-[0.5em] shadow-2xl flex items-center gap-4 transition-all active:scale-95 text-xs"><Save className="w-7 h-7" /> COMMENCE SYNC</button></div>
     </div>
   );
};

// --- LOGIN VIEW ---
const LoginView = ({ onLogin, addToast }: { onLogin: (u: User) => void, addToast: any }) => {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await DB.loginUser(username, pin);
      if (user) {
        onLogin(user);
        addToast('success', `Welcome, ${user.name}`);
      } else {
        addToast('error', 'Invalid Credentials');
        setPin('');
      }
    } catch (e: any) {
      addToast('error', 'Login Error: ' + (e.message || 'Unknown'));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 relative">
      <div className="w-full max-w-sm bg-zinc-900/50 backdrop-blur-xl border border-white/5 p-8 rounded-[48px] shadow-2xl">
        <div className="flex justify-center mb-10">
          <div className="w-20 h-20 rounded-[32px] bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-2xl border border-blue-500/20">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-black text-center text-white tracking-tighter mb-1 uppercase">SC DEBURRING</h1>
        <p className="text-center text-zinc-600 text-[10px] font-black uppercase tracking-[0.5em] mb-10 opacity-60">Control Terminal</p>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white font-black uppercase tracking-[0.2em] focus:border-blue-600 outline-none placeholder:text-zinc-800" placeholder="Identity" autoFocus />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white font-black tracking-[0.8em] focus:border-blue-600 outline-none" placeholder="PIN" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-6 rounded-[28px] font-black uppercase tracking-[0.4em] transition-all shadow-2xl shadow-blue-900/20 mt-4 disabled:opacity-50 active:scale-95">
            {loading ? 'VERIFYING...' : 'INIT_SESSION'}
          </button>
        </form>
      </div>
    </div>
  );
};

// --- ADMIN DASHBOARD ---
const AdminDashboard = ({ user, confirmAction, setView }: any) => {
   const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [logs, setLogs] = useState<TimeLog[]>([]);

   useEffect(() => {
     const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
     const unsub2 = DB.subscribeJobs(setJobs);
     const unsub3 = DB.subscribeLogs((all) => setLogs(all.slice(0, 5))); // Get last 5 logs
     return () => { unsub1(); unsub2(); unsub3(); };
   }, []);

   const liveJobsCount = new Set(activeLogs.map(l => l.jobId)).size;
   const wipJobsCount = jobs.filter(j => j.status === 'in-progress').length;
   const activeWorkersCount = new Set(activeLogs.map(l => l.userId)).size;

   // Check if admin is working
   const myActiveLog = activeLogs.find(l => l.userId === user.id);
   const myActiveJob = myActiveLog ? jobs.find(j => j.id === myActiveLog.jobId) : null;

   return (
      <div className="space-y-8 animate-fade-in">
         {myActiveLog && (
            <ActiveJobPanel job={myActiveJob || null} log={myActiveLog} onStop={(id) => DB.stopTimeLog(id)} />
         )}

         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex justify-between items-center relative overflow-hidden shadow-2xl backdrop-blur-xl group">
               <div className="relative z-10">
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Live Activity</p>
                   <h3 className="text-5xl font-black text-white leading-none tracking-tighter">{liveJobsCount}</h3>
                   <p className="text-xs text-blue-500 font-bold mt-3 uppercase tracking-widest">Active Phases</p>
               </div>
               <Activity className={`w-12 h-12 text-blue-500 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-10'}`} />
            </div>

            <div className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-2">In Progress</p>
                   <h3 className="text-5xl font-black text-white leading-none tracking-tighter">{wipJobsCount}</h3>
                   <p className="text-xs text-zinc-500 font-bold mt-3 uppercase tracking-widest">Pipeline Depth</p>
               </div>
               <Briefcase className="text-zinc-800 w-12 h-12" />
            </div>

            <div className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Floor Staff</p>
                   <h3 className="text-5xl font-black text-white leading-none tracking-tighter">{activeWorkersCount}</h3>
                   <p className="text-xs text-emerald-500 font-bold mt-3 uppercase tracking-widest">Synced Ops</p>
               </div>
               <Users className="text-zinc-800 w-12 h-12" />
            </div>
         </div>
         
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-xl">
                <div className="p-8 border-b border-white/5 bg-zinc-950/40 flex justify-between items-center">
                    <h3 className="font-black text-white flex items-center gap-4 uppercase text-sm tracking-[0.2em]"><Activity className="w-5 h-5 text-blue-500"/> Real-time Operations</h3>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar">
                   {activeLogs.length === 0 && <div className="p-12 text-center text-zinc-800 text-[10px] font-black uppercase tracking-widest opacity-40">Floor is quiet</div>}
                   {activeLogs.map(l => (
                      <div key={l.id} className="p-6 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                         <div className="flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center font-black text-zinc-500 border border-white/5 text-sm uppercase shadow-inner">{l.userName.charAt(0)}</div>
                            <div>
                                <p className="font-black text-white uppercase text-sm">{l.userName}</p>
                                <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest flex items-center gap-2 mt-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {l.operation}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-6">
                            <div className="text-white text-2xl font-black font-mono tracking-tighter leading-none"><LiveTimer startTime={l.startTime} /></div>
                            <button onClick={() => confirmAction({ title: "Force Termination", message: "Shut down this phase?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-3 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-lg"><Power className="w-4 h-4" /></button>
                         </div>
                      </div>
                   ))}
                </div>
             </div>

             <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-xl">
                <div className="p-8 border-b border-white/5 bg-zinc-950/40 flex justify-between items-center">
                    <h3 className="font-black text-white flex items-center gap-4 uppercase text-sm tracking-[0.2em]"><History className="w-5 h-5 text-blue-500"/> Sequence History</h3>
                    <button onClick={() => setView('admin-logs')} className="text-[9px] font-black text-blue-500 uppercase tracking-widest hover:text-white transition-colors flex items-center gap-2">Full Archive <ChevronRight className="w-3 h-3"/></button>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar">
                   {logs.length === 0 && <div className="p-12 text-center text-zinc-800 text-[10px] font-black uppercase tracking-widest opacity-40">No entries</div>}
                   {logs.map(l => (
                       <div key={l.id} className="p-6 flex items-start gap-5 hover:bg-white/[0.02] transition-colors group">
                           <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-800' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`}></div>
                           <div className="flex-1">
                               <p className="text-sm text-white font-black uppercase leading-tight">
                                   {l.userName} <span className="text-zinc-600">{l.endTime ? 'completed' : 'started'}</span> <span className="text-blue-500">{l.operation}</span>
                               </p>
                               <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mt-1">Batch: {l.jobId} • {new Date(l.startTime).toLocaleTimeString()}</p>
                           </div>
                           {l.durationMinutes && (
                               <div className="text-[10px] font-black text-zinc-500 font-mono bg-zinc-950 px-3 py-1.5 rounded-lg border border-white/5 group-hover:border-zinc-800 transition-colors">
                                   {formatDuration(l.durationMinutes)}
                               </div>
                           )}
                       </div>
                   ))}
                </div>
             </div>
         </div>
      </div>
   );
};

// --- APP ROOT ---
export function App() {
  const [user, setUser] = useState<User | null>(() => { try { return JSON.parse(localStorage.getItem('nexus_user') || 'null'); } catch(e) { return null; } });
  const [view, setView] = useState<AppView>('login');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [printable, setPrintable] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  useEffect(() => { if(user) { localStorage.setItem('nexus_user', JSON.stringify(user)); if(user.role === 'admin' && view === 'login') setView('admin-dashboard'); else if(user.role === 'employee' && view === 'login') setView('employee-scan'); } else { localStorage.removeItem('nexus_user'); setView('login'); } }, [user]);
  const addToast = (t: any, m: any) => setToasts(p => [...p, {id: Date.now().toString(), type: t, message: m}]);
  if (!user || view === 'login') return <><PrintStyles /><LoginView onLogin={setUser} addToast={addToast} /><div className="fixed bottom-4 right-4 z-[9999] pointer-events-none w-full max-w-xs px-6"><div className="pointer-events-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div></>;
  const NavItem = ({ id, l, i: Icon }: any) => (
    <button onClick={() => { setView(id); setIsMobileMenuOpen(false); }} className={`flex items-center gap-5 w-full px-8 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.3em] transition-all group ${view === id ? 'bg-zinc-800 text-white shadow-2xl border border-white/10 translate-x-2' : 'text-zinc-600 hover:text-white hover:bg-white/5'}`}><Icon className={`w-6 h-6 transition-transform group-hover:scale-110 ${view === id ? 'text-blue-500 scale-110' : ''}`} /> {l}</button>
  );
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col lg:flex-row font-sans overflow-x-hidden selection:bg-blue-500 selection:text-white">
       <PrintStyles /><ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
       {user.role === 'admin' && (
          <aside className={`fixed lg:sticky top-0 inset-y-0 left-0 w-80 border-r border-white/5 bg-zinc-950 flex flex-col z-50 transform transition-transform duration-700 ease-in-out shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
             <div className="p-12 hidden lg:flex flex-col gap-1 border-b border-white/5 mb-10"><div className="flex items-center gap-5"><div className="w-14 h-14 rounded-[22px] bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-2xl border border-blue-500/20"><Sparkles className="w-8 h-8 text-white"/></div><h2 className="font-black text-2xl tracking-tighter text-white uppercase leading-none">SC DEBURRING</h2></div><p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.6em] mt-4 opacity-60">Operations Core_v3</p></div>
             <nav className="flex-1 px-5 space-y-3.5 overflow-y-auto py-12 lg:py-0 custom-scrollbar"><NavItem id="admin-dashboard" l="Floor Overview" i={LayoutDashboard} /><NavItem id="admin-jobs" l="Production Batches" i={Briefcase} /><NavItem id="admin-logs" l="Global Archive" i={Calendar} /><NavItem id="admin-team" l="Human Resources" i={Users} /><NavItem id="admin-settings" l="Core Protocols" i={Settings} /><NavItem id="admin-scan" l="Floor Terminal" i={ScanLine} /></nav>
             <div className="p-8 border-t border-white/5 bg-zinc-900/30"><button onClick={() => setUser(null)} className="w-full flex items-center gap-5 px-8 py-5 text-zinc-700 hover:text-red-500 text-[11px] font-black uppercase tracking-[0.4em] transition-all rounded-[24px] hover:bg-red-500/5 group"><LogOut className="w-6 h-6 group-hover:scale-110 transition-all" /> Sign Out</button></div>
          </aside>
       )}
       <main className={`flex-1 p-6 md:p-16 w-full max-w-full overflow-x-hidden ${user.role === 'admin' ? '' : 'min-h-screen bg-zinc-950'}`}>
          <div className="max-w-7xl mx-auto">
            {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} />}
            {view === 'admin-jobs' && <JobsView addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} />}
            {view === 'admin-logs' && <LogsView addToast={addToast} />}
            {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
            {view === 'admin-settings' && <SettingsView addToast={addToast} />}
            {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} />}
            {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} />}
          </div>
       </main>
       <div className="fixed bottom-10 right-0 left-0 md:left-auto md:right-10 z-[9999] pointer-events-none px-8 md:px-0"><div className="pointer-events-auto flex flex-col items-end gap-4 max-w-md ml-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div>
    </div>
  );
}