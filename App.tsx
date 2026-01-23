import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink, RefreshCw, Calculator, Activity,
  Play, Archive, ClipboardList, Bell
} from 'lucide-react';
import { Toast } from './components/Toast';
import { Job, User, TimeLog, ToastMessage, AppView, SystemSettings } from './types';
import * as DB from './services/mockDb';
import { parseJobDetails } from './services/geminiService';

// --- UTILS ---
const formatDuration = (mins: number | undefined | null) => {
  if (mins === undefined || mins === null || mins < 0) return '0m';
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

const checkOverdue = (dueDateStr: string | undefined | null) => {
  if (!dueDateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00'); // Ensure local time parsing
  return due < today;
};

// Helper for MM/DD/YYYY
const formatToMDY = (dateStr: string | undefined | null) => {
  if (!dateStr) return 'N/A';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[1]}/${parts[2]}/${parts[0]}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
};

const PrintStyles = () => (
  <style>{`
    @media print {
      body * {
        visibility: hidden !important;
      }
      #printable-area-root, #printable-area-root * {
        visibility: visible !important;
      }
      #printable-area-root {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        color: black !important;
        z-index: 9999999 !important;
        display: block !important;
        border: none !important;
      }
      .no-print {
        display: none !important;
      }
      @page {
        size: portrait;
        margin: 0mm;
      }
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
  
  const isOverdue = job && checkOverdue(job.dueDate);

  return (
    <div className="bg-zinc-900 border border-blue-500/30 rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden animate-fade-in mb-6 no-print">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${isOverdue ? 'from-red-600 via-orange-500 to-red-600' : 'from-blue-600 via-purple-500 to-blue-600'} opacity-50 animate-pulse`}></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        <div className="flex flex-col justify-center">
           <div className="flex items-center gap-3 mb-3">
              <span className={`animate-pulse w-2.5 h-2.5 rounded-full ${isOverdue ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)]' : 'bg-blue-500'}`}></span>
              <span className={`${isOverdue ? 'text-red-500' : 'text-zinc-500'} font-black uppercase tracking-[0.2em] text-[10px]`}>{isOverdue ? 'CRITICAL: OVERDUE' : 'Timer Active'}</span>
           </div>
           <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.3em] mb-1">Purchase Order (PO)</p>
           <h2 className="text-3xl md:text-5xl font-black text-white mb-2 tracking-tighter leading-none uppercase break-all">{job ? job.poNumber : 'N/A'}</h2>
           <div className="text-lg md:text-2xl text-blue-400 font-black mb-6"><span className="px-4 py-1 bg-blue-500/10 rounded-xl border border-blue-500/20">{log.operation}</span></div>
           <div className="bg-black/60 rounded-2xl p-5 md:p-6 border border-white/10 mb-6 w-full max-w-sm flex items-center justify-between shadow-inner">
              <div>
                <p className="text-[9px] text-zinc-500 uppercase font-black tracking-[0.3em] mb-1 opacity-60">Elapsed Time</p>
                <div className="text-white text-3xl md:text-4xl font-black tracking-widest leading-none"><LiveTimer startTime={log.startTime} /></div>
              </div>
              <Clock className="w-10 h-10 text-zinc-800" />
           </div>
           <button onClick={handleStop} disabled={isStopping} className="w-full max-w-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-6 py-4 rounded-2xl font-black uppercase tracking-[0.3em] text-sm flex items-center justify-center gap-3 shadow-2xl transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer">
              {isStopping ? 'Stopping...' : <><StopCircle className="w-5 h-5" /> Stop Work</>}
           </button>
        </div>
        <div className="bg-white/[0.03] rounded-2xl p-5 md:p-6 border border-white/5 flex flex-col h-full backdrop-blur-xl shadow-inner relative">
           <h3 className="text-zinc-500 font-black uppercase text-[10px] mb-6 flex items-center gap-2 tracking-[0.3em]"><Info className="w-3.5 h-3.5 text-blue-500" /> Job Details</h3>
           {job ? (
             <div className="grid grid-cols-2 gap-y-6 gap-x-6">
               <div><label className="text-[9px] text-zinc-600 uppercase font-black tracking-widest">Part Index</label><div className="text-lg md:text-xl font-black text-white mt-1 break-words leading-none tracking-tight">{job.partNumber}</div></div>
               <div><label className="text-[9px] text-zinc-600 uppercase font-black tracking-widest">Batch ID</label><div className="text-lg md:text-xl font-black text-white mt-1 break-words leading-none tracking-tight">{job.jobIdsDisplay}</div></div>
               <div><label className="text-[9px] text-zinc-600 uppercase font-black tracking-widest">Batch Size</label><div className="text-lg md:text-xl font-black text-blue-500 mt-1 leading-none">{job.quantity} <span className="text-[10px] font-bold text-zinc-600 ml-0.5">UNITS</span></div></div>
               <div><label className="text-[9px] text-zinc-600 uppercase font-black tracking-widest">Due Date</label><div className={`text-lg md:text-xl font-black mt-1 leading-none ${isOverdue ? 'text-red-500 underline underline-offset-4 decoration-wavy' : 'text-white'}`}>{formatToMDY(job.dueDate) || 'N/A'}</div></div>
             </div>
           ) : <p className="text-zinc-500 font-black uppercase tracking-widest">Data Unavailable</p>}
        </div>
      </div>
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
    const user = await DB.loginUser(username, pin);
    if (user) { onLogin(user); addToast('success', `Welcome, ${user.name}`); }
    else { addToast('error', 'Invalid Credentials'); setPin(''); }
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
        <p className="text-center text-zinc-600 text-[10px] font-black uppercase tracking-[0.5em] mb-10 opacity-60">Log In</p>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white font-black uppercase tracking-[0.2em] focus:border-blue-600 outline-none placeholder:text-zinc-800" placeholder="Username" autoFocus />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white font-black tracking-[1em] focus:border-blue-600 outline-none" placeholder="PIN" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-6 rounded-[28px] font-black uppercase tracking-[0.4em] transition-all shadow-2xl shadow-blue-900/20 mt-4 disabled:opacity-50 active:scale-95">
            {loading ? 'Verifying...' : 'Sign In'}
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
     const unsub3 = DB.subscribeLogs((all) => setLogs(all.slice(0, 5)));
     return () => { unsub1(); unsub2(); unsub3(); };
   }, []);

   const liveJobsCount = new Set(activeLogs.map(l => l.jobId)).size;
   const wipJobsCount = jobs.filter(j => j.status === 'in-progress').length;
   const activeWorkersCount = new Set(activeLogs.map(l => l.userId)).size;

   // Notification Logic: Past Due Jobs
   const overdueActiveJobs = useMemo(() => {
     return jobs.filter(j => j.status !== 'completed' && checkOverdue(j.dueDate));
   }, [jobs]);

   return (
      <div className="space-y-6 animate-fade-in">
         {/* Overdue Alert Bar */}
         {overdueActiveJobs.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-[28px] flex flex-col md:flex-row justify-between items-center gap-4 animate-pulse shadow-2xl">
               <div className="flex items-center gap-4">
                  <div className="bg-red-600 p-2.5 rounded-2xl text-white shadow-lg shadow-red-900/30">
                    <Bell className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-red-500 font-black uppercase text-xs tracking-widest leading-none">Critical Priority Notification</h4>
                    <p className="text-[10px] text-red-400/70 font-bold uppercase mt-1 tracking-widest">{overdueActiveJobs.length} Job(s) are past their target deadlines</p>
                  </div>
               </div>
               <div className="flex gap-2">
                  {overdueActiveJobs.slice(0, 3).map(j => (
                    <span key={j.id} className="bg-red-950/40 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest">{j.poNumber}</span>
                  ))}
                  {overdueActiveJobs.length > 3 && <span className="bg-red-950/40 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest">+{overdueActiveJobs.length - 3} MORE</span>}
                  <button onClick={() => setView('admin-jobs')} className="ml-4 bg-red-600 hover:bg-red-500 text-white px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-xl transition-all active:scale-95">Address Now</button>
               </div>
            </div>
         )}

         <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="bg-zinc-900/40 border border-white/10 p-6 rounded-3xl flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-1">Active Now</p>
                   <h3 className="text-4xl font-black text-white leading-none tracking-tighter">{liveJobsCount}</h3>
               </div>
               <Activity className={`w-10 h-10 text-blue-500 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-10'}`} />
            </div>
            <div className="bg-zinc-900/40 border border-white/10 p-6 rounded-3xl flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-1">Production Queue</p>
                   <h3 className="text-4xl font-black text-white leading-none tracking-tighter">{wipJobsCount}</h3>
               </div>
               <Briefcase className="text-zinc-800 w-10 h-10" />
            </div>
            <div className="bg-zinc-900/40 border border-white/10 p-6 rounded-3xl flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-1">Employees Active</p>
                   <h3 className="text-4xl font-black text-white leading-none tracking-tighter">{activeWorkersCount}</h3>
               </div>
               <Users className="text-emerald-500/50 w-10 h-10" />
            </div>
         </div>
         
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             <div className="bg-zinc-900/40 border border-white/10 rounded-[32px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-xl">
                <div className="p-6 border-b border-white/5 bg-zinc-950/40 flex items-center justify-between">
                    <h3 className="font-black text-white flex items-center gap-3 uppercase text-xs tracking-[0.2em]"><Activity className="w-4 h-4 text-emerald-500"/> Current Operations</h3>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[350px] custom-scrollbar">
                   {activeLogs.map(l => (
                      <div key={l.id} className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                         <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center font-black text-zinc-500 border border-white/5 text-xs shadow-inner uppercase">{l.userName.charAt(0)}</div>
                            <div>
                                <p className="font-black text-white uppercase text-xs">{l.userName}</p>
                                <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mt-0.5">Job: {l.jobId} • {l.operation}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-5">
                            <div className="text-white text-xl font-black font-mono tracking-tighter"><LiveTimer startTime={l.startTime} /></div>
                            <button onClick={() => confirmAction({ title: "Stop Timer", message: "Hard-stop this worker's current timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-2.5 rounded-lg hover:bg-red-500 transition-all"><Power className="w-4 h-4" /></button>
                         </div>
                      </div>
                   ))}
                   {activeLogs.length === 0 && <div className="p-10 text-center text-zinc-700 text-[10px] font-black uppercase tracking-widest">No active timers</div>}
                </div>
             </div>
             <div className="bg-zinc-900/40 border border-white/10 rounded-[32px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-xl">
                <div className="p-6 border-b border-white/5 bg-zinc-950/40 flex justify-between items-center">
                    <h3 className="font-black text-white flex items-center gap-3 uppercase text-xs tracking-[0.2em]"><History className="w-4 h-4 text-blue-500"/> Recent Activity</h3>
                    <button onClick={() => setView('admin-logs')} className="text-[8px] font-black text-blue-500 uppercase tracking-widest hover:text-white transition-colors">View All</button>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[350px] custom-scrollbar">
                   {logs.map(l => (
                       <div key={l.id} className="p-4 flex items-start gap-4 hover:bg-white/[0.02] transition-colors">
                           <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-800' : 'bg-emerald-500 animate-pulse'}`}></div>
                           <div className="flex-1">
                               <p className="text-xs text-white font-black uppercase leading-tight">
                                   {l.userName} <span className="text-zinc-600">{l.endTime ? 'finished' : 'started'}</span> <span className="text-blue-500">{l.operation}</span>
                               </p>
                               <p className="text-[9px] text-zinc-600 font-black tracking-widest mt-0.5 uppercase">Job: {l.jobId}</p>
                           </div>
                       </div>
                   ))}
                   {logs.length === 0 && <div className="p-10 text-center text-zinc-700 text-[10px] font-black uppercase tracking-widest">No recent data</div>}
                </div>
             </div>
         </div>
      </div>
   );
};

// --- ADMIN: JOBS ---
const JobsView = ({ addToast, setPrintable, confirm }: any) => {
   const [jobs, setJobs] = useState<Job[]>([]);
   const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year' | 'all'>('week');
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [isSaving, setIsSaving] = useState(false);
   const [search, setSearch] = useState('');

   useEffect(() => DB.subscribeJobs(setJobs), []);

   // Precise Field Search
   const matchesSearch = (j: Job) => {
       if (!search) return true;
       const t = search.toLowerCase();
       return (
           j.poNumber.toLowerCase().includes(t) ||
           j.jobIdsDisplay.toLowerCase().includes(t) ||
           j.partNumber.toLowerCase().includes(t)
       );
   };

   const activeJobs = jobs.filter(j => j.status !== 'completed' && matchesSearch(j));
   const completedJobs = jobs.filter(j => j.status === 'completed' && matchesSearch(j));

   const handleSave = async () => {
    if (!editingJob.jobIdsDisplay || !editingJob.partNumber) return addToast('error', 'Required fields missing');
    setIsSaving(true);
    await DB.saveJob({ id: editingJob.id || Date.now().toString(), jobIdsDisplay: editingJob.jobIdsDisplay, poNumber: editingJob.poNumber || '', partNumber: editingJob.partNumber, quantity: editingJob.quantity || 0, dueDate: editingJob.dueDate || '', info: editingJob.info || '', status: editingJob.status || 'pending', dateReceived: editingJob.dateReceived || new Date().toISOString().split('T')[0], createdAt: editingJob.createdAt || Date.now() } as Job);
    addToast('success', 'Job Updated'); setShowModal(false); setIsSaving(false);
   };

   return (
      <div className="space-y-6 animate-fade-in">
         {/* Top Stats Bar */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             <div className="bg-zinc-900 border border-white/5 p-4 rounded-2xl">
                 <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total Batches</p>
                 <p className="text-2xl font-black text-white">{jobs.length}</p>
             </div>
             <div className="bg-blue-500/5 border border-blue-500/10 p-4 rounded-2xl">
                 <p className="text-[8px] font-black text-blue-500 uppercase tracking-widest mb-1">In Production</p>
                 <p className="text-2xl font-black text-blue-400">{activeJobs.length}</p>
             </div>
             <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl">
                 <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-1">Completed</p>
                 <p className="text-2xl font-black text-emerald-400">{completedJobs.length}</p>
             </div>
             <div className="bg-red-500/5 border border-red-500/10 p-4 rounded-2xl">
                 <p className="text-[8px] font-black text-red-500 uppercase tracking-widest mb-1">Priority Due</p>
                 <p className="text-2xl font-black text-red-400">{activeJobs.filter(j => j.dueDate && checkOverdue(j.dueDate)).length}</p>
             </div>
         </div>

         {/* Header */}
         <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t border-white/5">
             <h2 className="text-2xl font-bold text-white">Active Production</h2>
             <div className="flex gap-2 w-full md:w-auto">
                 <div className="relative flex-1 md:flex-initial">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter Production..." className="w-full md:w-64 bg-zinc-900 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                    {search && <button onClick={() => setSearch('')} className="absolute right-3 top-2.5 text-zinc-600 hover:text-white"><X className="w-4 h-4" /></button>}
                 </div>
                 <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-lg shadow-blue-900/20"><Plus className="w-4 h-4"/> Add Job</button>
             </div>
         </div>

         {/* Active Jobs Table */}
         <div className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden">
             <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                 <thead className="bg-white/5 text-zinc-400 font-bold uppercase text-[10px]">
                     <tr>
                         <th className="px-6 py-4">Purchase Order (PO)</th>
                         <th className="px-6 py-4">Batch ID</th>
                         <th className="px-6 py-4">Part Index</th>
                         <th className="px-6 py-4">Lot Size</th>
                         <th className="px-6 py-4">Status</th>
                         <th className="px-6 py-4">Due Date</th>
                         <th className="px-6 py-4 text-right">Actions</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-white/5">
                     {activeJobs.map(j => {
                         const isOverdue = checkOverdue(j.dueDate);
                         return (
                            <tr key={j.id} className={`hover:bg-white/5 transition-colors group ${isOverdue ? 'bg-red-500/[0.03]' : ''}`}>
                                <td className="px-6 py-4 font-bold text-white whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        {j.poNumber}
                                        {isOverdue && <span className="bg-red-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full animate-pulse shadow-lg shadow-red-900/40">OVERDUE</span>}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-zinc-300 font-mono text-xs uppercase whitespace-nowrap">{j.jobIdsDisplay}</td>
                                <td className="px-6 py-4 text-zinc-400 whitespace-nowrap">{j.partNumber}</td>
                                <td className="px-6 py-4 text-zinc-300 font-bold">{j.quantity} Units</td>
                                <td className="px-6 py-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border flex items-center gap-1.5 w-fit ${j.status === 'in-progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>
                                        {j.status === 'in-progress' && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>}
                                        {j.status}
                                    </span>
                                </td>
                                <td className={`px-6 py-4 whitespace-nowrap font-black text-xs ${isOverdue ? 'text-red-500' : 'text-zinc-400'}`}>{formatToMDY(j.dueDate) || '-'}</td>
                                <td className="px-6 py-4 text-right flex justify-end gap-2">
                                    <button onClick={() => confirm({ title: "Complete Job", message: "Move this job to finished history?", onConfirm: () => DB.completeJob(j.id) })} className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all" title="Finish Job"><CheckCircle className="w-4 h-4" /></button>
                                    <button onClick={() => setPrintable(j)} className="p-2 bg-zinc-800 text-zinc-400 rounded-lg border border-white/5 hover:text-white hover:bg-zinc-700 transition-all" title="Print Sheet"><Printer className="w-4 h-4" /></button>
                                    <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20 hover:text-white hover:bg-blue-500 transition-all" title="Edit"><Edit2 className="w-4 h-4" /></button>
                                    <button onClick={() => confirm({ title: "Delete", message: "Permanently delete this job?", onConfirm: () => DB.deleteJob(j.id) })} className="p-2 bg-red-500/10 text-red-500 rounded-lg border border-red-500/20 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 className="w-4 h-4" /></button>
                                </td>
                            </tr>
                         );
                     })}
                     {activeJobs.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-zinc-600 text-xs font-bold uppercase tracking-widest">Production Queue Empty</td></tr>}
                 </tbody>
             </table>
             </div>
         </div>

         {/* History Section */}
         <div className="space-y-4 pt-12 border-t border-white/5">
             <div className="flex justify-between items-center">
                 <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                     <History className="w-4 h-4" /> Finished Batch History
                 </h3>
                 <div className="flex bg-zinc-900 border border-white/5 rounded-lg p-1">
                     {['week', 'month', 'year', 'all'].map(t => (
                         <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-3 py-1.5 rounded text-[10px] font-black uppercase transition-colors ${timeFilter === t ? 'bg-zinc-800 text-white shadow' : 'text-zinc-600 hover:text-zinc-400'}`}>{t}</button>
                     ))}
                 </div>
             </div>
             
             <div className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden">
                 <div className="overflow-x-auto">
                 <table className="w-full text-left text-sm">
                     <thead className="bg-white/5 text-zinc-500 uppercase text-[10px] font-bold">
                        <tr>
                            <th className="px-6 py-4">Purchase Order (PO)</th>
                            <th className="px-6 py-4">Batch ID</th>
                            <th className="px-6 py-4">Part Index</th>
                            <th className="px-6 py-4">Units</th>
                            <th className="px-6 py-4">Completed On</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-white/5">
                        {completedJobs.map(j => (
                            <tr key={j.id} className="hover:bg-white/5 transition-colors">
                                <td className="px-6 py-4 font-bold text-white opacity-50 whitespace-nowrap">{j.poNumber}</td>
                                <td className="px-6 py-4 text-zinc-500 font-mono text-xs uppercase whitespace-nowrap">{j.jobIdsDisplay}</td>
                                <td className="px-6 py-4 text-zinc-500 whitespace-nowrap">{j.partNumber}</td>
                                <td className="px-6 py-4 text-zinc-500">{j.quantity}</td>
                                <td className="px-6 py-4 text-zinc-500 whitespace-nowrap">{j.completedAt ? new Date(j.completedAt).toLocaleDateString() : '-'}</td>
                                <td className="px-6 py-4 text-right flex justify-end gap-2">
                                     <button onClick={() => confirm({ title: "Reactivate", message: "Move this job back to production?", onConfirm: () => DB.reopenJob(j.id) })} className="p-2 bg-blue-500/10 text-blue-500 rounded-lg border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all"><RotateCcw className="w-4 h-4" /></button>
                                     <button onClick={() => setPrintable(j)} className="p-2 bg-zinc-800 text-zinc-500 rounded-lg border border-white/5 hover:text-white hover:bg-zinc-700 transition-all"><Printer className="w-4 h-4" /></button>
                                     <button onClick={() => confirm({ title: "Delete Record", message: "Permanently erase this record?", onConfirm: () => DB.deleteJob(j.id) })} className="p-2 bg-zinc-800 text-red-500 rounded-lg border border-white/5 hover:bg-red-600 hover:text-white transition-all"><Trash2 className="w-4 h-4" /></button>
                                </td>
                            </tr>
                        ))}
                        {completedJobs.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-zinc-600 text-xs font-bold uppercase tracking-widest">History Empty</td></tr>}
                     </tbody>
                 </table>
                 </div>
             </div>
         </div>

         {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
               <div className="bg-zinc-900 border border-white/10 w-full max-w-xl rounded-[40px] shadow-2xl p-8">
                  <div className="flex justify-between items-center mb-8"><h3 className="font-black text-white uppercase text-xl tracking-tight leading-none">Job Matrix</h3><button onClick={() => setShowModal(false)} className="p-3 bg-white/5 rounded-xl text-zinc-600 hover:text-white"><X className="w-5 h-5" /></button></div>
                  <div className="space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar pr-3">
                     <div className="space-y-2"><label className="text-[9px] text-blue-500 font-black uppercase tracking-[0.3em] ml-2">Purchase Order (PO)</label><input className="w-full bg-black/60 border border-white/5 rounded-2xl p-4 text-white text-2xl font-black outline-none tracking-tight uppercase focus:border-blue-600 transition-all shadow-inner" placeholder="PO-" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} /></div>
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Batch ID</label><input className="w-full bg-black/30 border border-white/5 rounded-2xl p-3.5 text-xs font-black text-white shadow-inner uppercase tracking-widest" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Part Catalog #</label><input className="w-full bg-black/30 border border-white/5 rounded-2xl p-3.5 text-xs font-black text-white shadow-inner uppercase tracking-widest" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
                     </div>
                     <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Lot Units</label><input type="number" className="w-full bg-black/30 border border-white/5 rounded-2xl p-3.5 text-base font-black text-blue-500 shadow-inner" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Received</label><input type="date" className="w-full bg-zinc-800 border border-white/5 rounded-2xl p-3.5 text-white text-[10px] font-black uppercase shadow-inner" value={editingJob.dateReceived || ''} onChange={e => setEditingJob({...editingJob, dateReceived: e.target.value})} /></div>
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Target Date</label><input type="date" className="w-full bg-zinc-800 border border-white/5 rounded-2xl p-3.5 text-white text-[10px] font-black uppercase shadow-inner" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
                     </div>
                     <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Floor Logic</label><textarea className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-[10px] text-zinc-400 italic shadow-inner" rows={3} placeholder="..." value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
                  </div>
                  <div className="mt-8 flex justify-end gap-4"><button onClick={() => setShowModal(false)} className="px-6 py-3 text-zinc-600 hover:text-white text-[9px] font-black uppercase tracking-[0.3em] transition-all">Discard</button><button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95">{isSaving ? 'Syncing...' : 'Commit Batch'}</button></div>
               </div>
            </div>
         )}
      </div>
   );
};

// --- ADMIN: LOGS ---
const LogsView = ({ addToast, confirm }: { addToast: any, confirm: any }) => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
   const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year' | 'all'>('week');
   const [search, setSearch] = useState('');
   const [tab, setTab] = useState<'current' | 'archive'>('current');

   useEffect(() => {
     const u1 = DB.subscribeLogs(setLogs);
     const u2 = DB.subscribeJobs(setJobs);
     return () => { u1(); u2(); };
   }, []);

   const currentLogs = useMemo(() => {
     return logs.filter(l => {
       const job = jobs.find(j => j.id === l.jobId);
       return job && job.status !== 'completed';
     });
   }, [logs, jobs]);

   const archiveLogs = useMemo(() => {
     return logs.filter(l => {
       const job = jobs.find(j => j.id === l.jobId);
       return job && job.status === 'completed';
     });
   }, [logs, jobs]);

   const getGroupedLogs = (source: TimeLog[]) => {
     const now = Date.now();
     const groups: Record<string, { job: Job | null, logs: TimeLog[], totalMins: number }> = {};
     
     source.forEach(log => {
        if (!groups[log.jobId]) {
           groups[log.jobId] = { job: jobs.find(j => j.id === log.jobId) || null, logs: [], totalMins: 0 };
        }
        groups[log.jobId].logs.push(log);
        if (log.durationMinutes) groups[log.jobId].totalMins += log.durationMinutes;
     });

     const result = Object.entries(groups).filter(([jobId, data]) => {
        if (search) {
            const t = search.toLowerCase();
            const poMatch = data.job?.poNumber.toLowerCase().includes(t);
            const jobMatch = data.job?.jobIdsDisplay.toLowerCase().includes(t);
            const userMatch = data.logs.some(l => l.userName.toLowerCase().includes(t));
            if (!poMatch && !jobMatch && !userMatch) return false;
        }

        if (timeFilter !== 'all') {
            const latestLogTime = data.logs.length > 0 ? Math.max(...data.logs.map(l => l.startTime)) : 0;
            const diff = now - latestLogTime;
            const limits = { week: 7, month: 30, year: 365 };
            if (diff > (limits[timeFilter as keyof typeof limits] * 24 * 60 * 60 * 1000)) return false;
        }
        return true;
     });
     
     return result.sort((a,b) => {
         const timeA = a[1].logs.length > 0 ? Math.max(...a[1].logs.map(l => l.startTime)) : 0;
         const timeB = b[1].logs.length > 0 ? Math.max(...b[1].logs.map(l => l.startTime)) : 0;
         return timeB - timeA;
     });
   };

   const handleSaveLog = async () => {
       if (editingLog) { await DB.updateTimeLog(editingLog); addToast('success', 'Records Sync Successful'); setEditingLog(null); }
   };

   const handleDeleteLog = (id: string) => {
      confirm({
         title: "Delete Work Record",
         message: "Permanently erase this specific time entry? This cannot be undone.",
         onConfirm: async () => {
            await DB.deleteTimeLog(id);
            addToast('success', 'Entry Erased');
            setEditingLog(null);
         }
      });
   };

   const totalHours = (tab === 'current' ? currentLogs : archiveLogs).reduce((acc, l) => acc + (l.durationMinutes || 0), 0) / 60;
   const uniqueJobsCount = new Set((tab === 'current' ? currentLogs : archiveLogs).map(l => l.jobId)).size;

   return (
      <div className="space-y-8 animate-fade-in">
         <div className="flex flex-col gap-6">
             <div className="flex justify-between items-center">
                 <h2 className="text-2xl font-bold text-white flex items-center gap-2 uppercase tracking-tighter"><Calendar className="w-6 h-6 text-blue-500" /> Work Logs</h2>
                 <div className="flex bg-zinc-900 border border-white/5 rounded-lg p-1">
                     {['week', 'month', 'year', 'all'].map(t => (
                         <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-4 py-1.5 rounded text-[10px] font-black uppercase transition-colors ${timeFilter === t ? 'bg-zinc-800 text-white shadow' : 'text-zinc-600 hover:text-white'}`}>This {t}</button>
                     ))}
                 </div>
             </div>

             <div className="flex gap-3">
                 <div className="relative flex-1">
                     <Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
                     <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by PO, Job, or Personnel..." className="w-full bg-zinc-900 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                     {search && <button onClick={() => setSearch('')} className="absolute right-3 top-3.5 text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>}
                 </div>
                 <button className="px-4 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"><RefreshCw className="w-4 h-4"/></button>
             </div>
         </div>

         <div className="flex gap-4 border-b border-white/5 pb-1">
             <button onClick={() => setTab('current')} className={`pb-4 px-4 text-xs font-black uppercase tracking-widest transition-all relative ${tab === 'current' ? 'text-blue-500' : 'text-zinc-600 hover:text-white'}`}>
                 Current Production
                 {tab === 'current' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 rounded-t-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>}
             </button>
             <button onClick={() => setTab('archive')} className={`pb-4 px-4 text-xs font-black uppercase tracking-widest transition-all relative ${tab === 'archive' ? 'text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'}`}>
                 Completed Archive
                 {tab === 'archive' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-white rounded-t-full"></div>}
             </button>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             <div className="bg-blue-900/10 border border-blue-500/20 p-6 rounded-2xl">
                 <div className="flex items-center gap-2 text-blue-400 mb-1"><Clock className="w-4 h-4"/><p className="text-xs font-bold uppercase tracking-wider">Filtered Period Time</p></div>
                 <p className="text-3xl font-black text-blue-100">{totalHours.toFixed(2)} <span className="text-lg font-medium text-blue-500">HRS</span></p>
             </div>
             <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-2xl">
                 <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Total Log Entries</p>
                 <p className="text-3xl font-black text-white">{tab === 'current' ? currentLogs.length : archiveLogs.length}</p>
             </div>
             <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-2xl">
                 <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Active Batch Count</p>
                 <p className="text-3xl font-black text-white">{uniqueJobsCount}</p>
             </div>
         </div>

         <div className="space-y-6 pb-20">
             {getGroupedLogs(tab === 'current' ? currentLogs : archiveLogs).map(([jobId, data]) => (
                 <div key={jobId} className="bg-zinc-900/40 border border-white/5 rounded-2xl overflow-hidden shadow-xl animate-fade-in mb-6">
                     <div className="p-4 md:p-6 bg-zinc-900/60 border-b border-white/5 flex flex-col md:flex-row justify-between md:items-center gap-4">
                         <div className="flex items-center gap-4">
                             <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${tab === 'current' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>
                                 <Briefcase className="w-6 h-6" />
                             </div>
                             <div>
                                 <h3 className="text-xl font-black text-white">{data.job?.poNumber || 'Legacy Batch'}</h3>
                                 <p className="text-[10px] font-bold text-zinc-500 uppercase mt-1 tracking-wider">
                                     Batch: <span className="text-zinc-300">{data.job?.jobIdsDisplay || jobId}</span> <span className="mx-2 text-zinc-700">|</span> Catalog: <span className="text-zinc-300">{data.job?.partNumber || 'N/A'}</span>
                                 </p>
                             </div>
                         </div>
                         <div className="flex items-center gap-8 text-right bg-zinc-950/50 p-3 rounded-xl border border-white/5 shadow-inner">
                             <div>
                                 <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Job Period Time</p>
                                 <p className="text-lg font-bold text-white tabular-nums">{formatDuration(data.totalMins)}</p>
                             </div>
                             <div className="border-l border-white/10 pl-6">
                                 <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Record Count</p>
                                 <p className="text-lg font-bold text-white tabular-nums">{data.logs.length}</p>
                             </div>
                         </div>
                     </div>
                     
                     <div className="overflow-x-auto">
                         <table className="w-full text-left text-sm">
                             <thead className="bg-white/5 text-zinc-500 uppercase text-[10px] font-bold tracking-wider">
                                 <tr>
                                     <th className="px-6 py-3">Date</th>
                                     <th className="px-6 py-3">Time Range</th>
                                     <th className="px-6 py-3">Personnel</th>
                                     <th className="px-6 py-3">Step</th>
                                     <th className="px-6 py-3 text-right">Duration</th>
                                     <th className="w-12"></th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y divide-white/5">
                                 {data.logs.map(l => (
                                     <tr key={l.id} className="hover:bg-white/5 transition-colors group">
                                         <td className="px-6 py-4 text-zinc-400">{new Date(l.startTime).toLocaleDateString()}</td>
                                         <td className="px-6 py-4 text-zinc-500 font-mono text-xs uppercase whitespace-nowrap">
                                             {new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - {l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : <span className="text-emerald-400 font-bold">Active</span>}
                                         </td>
                                         <td className="px-6 py-4 whitespace-nowrap">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-bold text-zinc-400 border border-white/5 uppercase shadow-inner">{l.userName.charAt(0)}</div>
                                                 <span className="text-white font-bold text-xs uppercase">{l.userName}</span>
                                             </div>
                                         </td>
                                         <td className="px-6 py-4">
                                             <span className="bg-zinc-800 text-zinc-400 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border border-white/5">{l.operation}</span>
                                         </td>
                                         <td className="px-6 py-4 text-right text-white font-bold font-mono text-xs tabular-nums">{formatDuration(l.durationMinutes)}</td>
                                         <td className="px-4 text-right">
                                             <button onClick={() => setEditingLog(l)} className="text-zinc-600 hover:text-white opacity-0 group-hover:opacity-100 transition-all bg-zinc-800 p-1.5 rounded-lg border border-white/5"><Edit2 className="w-3 h-3"/></button>
                                         </td>
                                     </tr>
                                 ))}
                             </tbody>
                         </table>
                     </div>
                 </div>
             ))}
             {getGroupedLogs(tab === 'current' ? currentLogs : archiveLogs).length === 0 && (
                 <div className="py-20 text-center text-zinc-700 text-xs font-black uppercase tracking-[0.5em] bg-zinc-900/20 border-2 border-dashed border-white/5 rounded-[40px]">
                     Filtered archive contains no records
                 </div>
             )}
         </div>

         {editingLog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
               <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-[40px] shadow-2xl p-8 overflow-hidden">
                  <div className="flex justify-between items-center mb-8"><h3 className="font-black text-white uppercase text-xl tracking-tight leading-none">Modify Entry</h3><button onClick={() => setEditingLog(null)} className="p-3 bg-white/5 rounded-xl text-zinc-600 hover:text-white"><X className="w-5 h-5" /></button></div>
                  <div className="space-y-6">
                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2 block">Phase In</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-2xl p-4 text-white text-[10px] font-black uppercase tracking-widest shadow-inner outline-none focus:border-blue-600 transition-all" value={toDateTimeLocal(editingLog.startTime)} onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})} /></div>
                        <div className="space-y-2"><label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2 block">Phase Out</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-2xl p-4 text-white text-[10px] font-black uppercase tracking-widest shadow-inner outline-none focus:border-blue-600 transition-all" value={toDateTimeLocal(editingLog.endTime)} onChange={e => setEditingLog({...editingLog, endTime: e.target.value ? new Date(e.target.value).getTime() : null})} /></div>
                     </div>
                  </div>
                  <div className="mt-10 flex justify-between gap-4">
                     <button onClick={() => handleDeleteLog(editingLog.id)} className="flex items-center gap-2 px-6 py-3 text-red-500 hover:text-white hover:bg-red-500/10 rounded-2xl text-[9px] font-black uppercase tracking-[0.3em] transition-all"><Trash2 className="w-4 h-4" /> Erase Entry</button>
                     <div className="flex gap-4">
                        <button onClick={() => setEditingLog(null)} className="px-6 py-3 text-zinc-600 hover:text-white text-[9px] font-black uppercase tracking-[0.3em] transition-all">Abort</button>
                        <button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95">Commit Sync</button>
                     </div>
                  </div>
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
     if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'Profile data is missing');
     DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true });
     setShowModal(false); addToast('success', 'Personnel Configured');
   };
   return (
     <div className="space-y-8 animate-fade-in">
        <div className="flex justify-between items-center"><h2 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Global Personnel</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl flex items-center gap-2.5 text-[9px] font-black uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95"><Plus className="w-4 h-4" /> Add Member</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {users.map(u => (
            <div key={u.id} className="bg-zinc-900/40 border border-white/10 p-6 rounded-[32px] flex items-center justify-between shadow-2xl backdrop-blur-xl group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-500 font-black border border-white/10 text-lg shadow-inner group-hover:text-blue-500 uppercase">{u.name.charAt(0)}</div>
                <div><p className="font-black text-white text-base tracking-tight leading-none mb-1 uppercase">{u.name}</p><p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest">@{u.username} • {u.role}</p></div>
              </div>
              <div className="flex gap-1.5">
                 <button onClick={() => confirm({ title: "Revoke Access", message: "Permanently delete this user profile?", onConfirm: () => DB.deleteUser(u.id) })} className="p-3 hover:bg-red-500/10 text-zinc-700 hover:text-red-500 transition-all rounded-xl"><Trash2 className="w-4.5 h-4.5" /></button>
                 <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-3 hover:bg-white/5 text-zinc-600 hover:text-white transition-all rounded-xl"><Edit2 className="w-4.5 h-4.5" /></button>
              </div>
            </div>
          ))}
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4">
             <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[48px] shadow-2xl p-8">
                <div className="flex justify-between items-center mb-8 leading-none"><h3 className="font-bold text-white text-lg uppercase tracking-tight">Personnel Form</h3><button onClick={() => setShowModal(false)} className="p-2.5 bg-white/5 rounded-xl text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button></div>
                <div className="space-y-5">
                  <div className="space-y-1.5"><label className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Full Name</label><input className="w-full bg-black/40 border border-white/5 rounded-xl p-3.5 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all uppercase" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Username</label><input className="w-full bg-black/40 border border-white/5 rounded-xl p-3.5 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Cipher (PIN)</label><input type="text" className="w-full bg-black/40 border border-white/5 rounded-xl p-3.5 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all tracking-[0.4em]" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Access Level</label><select className="w-full bg-black/40 border border-white/5 rounded-xl p-3.5 text-white text-sm font-bold outline-none" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
                </div>
                <div className="p-8 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-3 mt-8"><button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-white text-[9px] font-black uppercase tracking-widest">Abort</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3.5 rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] transition-all active:scale-95">Commit Sync</button></div>
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
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Core Synced'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   const handleDeleteOp = (op: string) => { setSettings({...settings, customOperations: (settings.customOperations || []).filter(o => o !== op)}); };
   return (
     <div className="max-w-xl space-y-10 animate-fade-in">
        <h2 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Settings</h2>
        
        <div className="bg-zinc-900/40 border border-white/10 rounded-[32px] p-8 space-y-10 shadow-2xl backdrop-blur-xl">
           <div className="flex items-center gap-5 border-b border-white/10 pb-8">
               <div className="bg-orange-600/10 p-4 rounded-2xl text-orange-500 border border-orange-500/20">
                   <Clock className="w-8 h-8" />
               </div>
               <div>
                   <h3 className="font-black text-white uppercase text-lg tracking-tight">Auto-Termination</h3>
                   <p className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] mt-1.5">Shift cleanup rules</p>
               </div>
           </div>
           <div className="space-y-6">
               <div className="flex items-center justify-between p-4 bg-zinc-950/50 rounded-2xl border border-white/5 shadow-inner">
                   <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Enable Auto-Stop</label>
                   <div className="relative inline-block w-12 h-6 transition duration-200 ease-in-out">
                       <input 
                           type="checkbox" 
                           id="auto-stop-toggle"
                           className="peer absolute opacity-0 w-full h-full cursor-pointer z-10"
                           checked={settings.autoClockOutEnabled} 
                           onChange={e => setSettings({...settings, autoClockOutEnabled: e.target.checked})}
                       />
                       <label htmlFor="auto-stop-toggle" className={`block overflow-hidden h-6 rounded-full cursor-pointer transition-colors duration-200 border border-white/5 ${settings.autoClockOutEnabled ? 'bg-blue-600' : 'bg-zinc-800'}`}></label>
                       <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${settings.autoClockOutEnabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                   </div>
               </div>
               <div className="space-y-2">
                   <label className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2 block">Trigger Time</label>
                   <input 
                       type="time" 
                       value={settings.autoClockOutTime} 
                       onChange={e => setSettings({...settings, autoClockOutTime: e.target.value})} 
                       className="w-full bg-black/50 border border-white/5 rounded-2xl px-6 py-4 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all uppercase placeholder-zinc-800" 
                   />
               </div>
           </div>
        </div>

        <div className="bg-zinc-900/40 border border-white/10 rounded-[32px] p-8 space-y-10 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-5 border-b border-white/10 pb-8"><div className="bg-blue-600/10 p-4 rounded-2xl text-blue-500 border border-blue-500/20"><Activity className="w-8 h-8" /></div><div><h3 className="font-black text-white uppercase text-lg tracking-tight">Work Steps</h3><p className="text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em] mt-1.5">Operational flow control</p></div></div>
            <div className="space-y-6">
                <div className="flex gap-3"><input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="New step..." className="flex-1 bg-black/50 border border-white/5 rounded-2xl px-6 py-4 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all uppercase placeholder-zinc-800" onKeyDown={e => e.key === 'Enter' && handleAddOp()} /><button onClick={handleAddOp} className="bg-blue-600 px-6 rounded-2xl text-white font-black hover:bg-blue-500 transition-all active:scale-95 shadow-2xl"><Plus className="w-6 h-6" /></button></div>
                <div className="flex flex-wrap gap-3">{(settings.customOperations || []).map(op => <div key={op} className="bg-zinc-950 border border-white/5 px-4 py-2.5 rounded-xl flex items-center gap-4 group hover:border-blue-500/50 transition-all shadow-inner"><span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 group-hover:text-white transition-colors">{op}</span><button onClick={() => handleDeleteOp(op)} className="text-zinc-800 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button></div>)}</div>
            </div>
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-5 rounded-[28px] font-black uppercase tracking-[0.4em] shadow-2xl flex items-center gap-3 transition-all active:scale-95 text-[10px]"><Save className="w-6 h-6" /> Save Settings</button></div>
     </div>
   );
};

// --- COMPONENT: CONFIRMATION MODAL ---
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-3xl p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[40px] p-8 shadow-2xl">
        <h3 className="text-xl font-black text-white mb-3 flex items-center gap-3 uppercase tracking-tighter"><AlertTriangle className="text-red-500 w-5 h-5" /> {title}</h3>
        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest leading-relaxed mb-8 opacity-80">{message}</p>
        <div className="flex justify-end gap-5">
          <button onClick={onCancel} className="text-zinc-600 hover:text-white text-[9px] font-black uppercase tracking-[0.3em] transition-all">Abort</button>
          <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95">Confirm</button>
        </div>
      </div>
    </div>
  );
};

// --- HELPER: JOB SELECTION CARD ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);
  const isOverdue = checkOverdue(job.dueDate);

  return (
    <div className={`bg-zinc-900/40 border border-white/5 rounded-3xl overflow-hidden transition-all duration-300 ${expanded ? 'border-blue-500/50 bg-zinc-900/80 shadow-2xl' : 'hover:bg-zinc-900/60'} ${disabled ? 'opacity-30 pointer-events-none grayscale' : ''} shadow-2xl backdrop-blur-xl`}>
      <div className="p-6 cursor-pointer group" onClick={() => setExpanded(!expanded)}>
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Purchase Order (PO)</p>
                {isOverdue && <span className="bg-red-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full animate-pulse">OVERDUE</span>}
            </div>
            <h3 className={`text-2xl font-black tracking-tighter uppercase leading-none ${isOverdue ? 'text-red-500' : 'text-white'}`}>{job.poNumber}</h3>
          </div>
          <span className="bg-black/40 border border-white/5 text-blue-500 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-inner">{job.quantity} PCS</span>
        </div>
        <div className="space-y-1.5 border-t border-white/5 pt-3">
          <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Part Index: <span className="text-zinc-400">{job.partNumber}</span></p>
          <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Batch ID: <span className="text-zinc-500">{job.jobIdsDisplay}</span></p>
        </div>
        
        {!expanded && (
          <div className={`mt-4 flex items-center text-[10px] font-black uppercase tracking-[0.3em] opacity-0 group-hover:opacity-100 transition-all translate-y-1 group-hover:translate-y-0 ${isOverdue ? 'text-red-500' : 'text-blue-500'}`}>
            Initialize Work <ArrowRight className="w-3 h-3 ml-1.5" />
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-6 bg-black/40 border-t border-white/5 animate-fade-in">
          <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-1.5"><Settings className="w-4 h-4 text-blue-500"/> Choose Step</p>
          <div className="grid grid-cols-1 gap-3">
            {operations.map(op => (
              <button
                key={op}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(job.id, op);
                }}
                className={`bg-zinc-800/80 hover:text-white border border-white/10 py-8 px-6 rounded-2xl text-2xl font-black uppercase tracking-[0.1em] transition-all shadow-2xl active:scale-95 text-left flex justify-between items-center group/op ${isOverdue ? 'hover:bg-red-600' : 'hover:bg-blue-600'}`}
              >
                {op}
                <Play className="w-8 h-8 opacity-0 group-hover/op:opacity-100 transition-opacity" />
              </button>
            ))}
             {operations.length === 0 && <p className="text-[10px] text-zinc-700 font-black uppercase text-center py-2 tracking-widest">Logic null</p>}
          </div>
        </div>
      )}
    </div>
  );
};

// --- COMPONENT: EMPLOYEE DASHBOARD ---
const EmployeeDashboard = ({ user, addToast, onLogout }: { user: User, addToast: any, onLogout: () => void }) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);
  const [ops, setOps] = useState<string[]>([]);

  useEffect(() => {
    const settings = DB.getSettings();
    setOps(settings.customOperations || []);

    const unsubLogs = DB.subscribeLogs((allLogs) => {
       const myActive = allLogs.find(l => l.userId === user.id && !l.endTime);
       const history = allLogs.filter(l => l.userId === user.id).sort((a,b) => b.startTime - a.startTime);
       setActiveLog(myActive || null);
       setMyHistory(history);
       
       if (myActive) {
          DB.getJobById(myActive.jobId).then(j => setActiveJob(j || null));
       } else {
          setActiveJob(null);
       }
    });

    const unsubJobs = DB.subscribeJobs((allJobs) => {
        setJobs(allJobs.filter(j => j.status !== 'completed').reverse());
    });

    return () => { unsubLogs(); unsubJobs(); };
  }, [user.id]);

  const handleStartJob = async (jobId: string, operation: string) => {
    try {
        await DB.startTimeLog(jobId, user.id, user.name, operation);
        addToast('success', 'PHASE_INITIALIZED');
    } catch (e) {
        addToast('error', 'FAILED_TO_START');
    }
  };

  const handleStopJob = async (logId: string) => {
    try {
      await DB.stopTimeLog(logId);
      addToast('success', 'PHASE_TERMINATED');
    } catch (e) {
      addToast('error', 'SYNC_ERROR');
    }
  };

  const handleScan = (e: any) => {
      if (e.key === 'Enter') {
          let val = e.currentTarget.value.trim();
          const match = val.match(/[?&]jobId=([^&]+)/);
          if (match) val = match[1];
          setSearch(val); 
          setTab('jobs'); 
          addToast('success', 'CAPTURED');
      }
  }

  // Group history by date
  const groupedHistory = useMemo(() => {
      const groups: Record<string, TimeLog[]> = {};
      myHistory.forEach(log => {
          const d = new Date(log.startTime).toLocaleDateString();
          if (!groups[d]) groups[d] = [];
          groups[d].push(log);
      });
      return Object.entries(groups).sort((a,b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [myHistory]);

  const filteredJobs = jobs.filter(j => {
    if (!search) return true;
    const t = search.toLowerCase();
    return (
        j.poNumber.toLowerCase().includes(t) ||
        j.jobIdsDisplay.toLowerCase().includes(t) ||
        j.partNumber.toLowerCase().includes(t)
    );
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto h-full flex flex-col pb-20 animate-fade-in">
      {activeLog && (
        <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} />
      )}

      <div className="flex flex-wrap gap-3 justify-between items-center bg-zinc-900/60 backdrop-blur-2xl p-3 rounded-[28px] border border-white/5 shadow-2xl no-print">
         <div className="flex gap-3 p-1 bg-black/40 rounded-xl border border-white/5 shadow-inner">
           <button onClick={() => setTab('jobs')} className={`px-6 py-2.5 rounded-lg text-[9px] font-black uppercase tracking-[0.3em] transition-all ${tab === 'jobs' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Active Queue</button>
           <button onClick={() => setTab('history')} className={`px-6 py-2.5 rounded-lg text-[9px] font-black uppercase tracking-[0.3em] transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}><History className="w-3.5 h-3.5" /> Work Logs</button>
         </div>
         <div className="flex items-center gap-3">
             <button onClick={() => setTab('scan')} className={`px-5 py-3 rounded-xl text-[9px] font-black uppercase tracking-[0.3em] flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow-xl' : 'bg-zinc-800 text-blue-500 hover:bg-blue-600 hover:text-white shadow-xl'}`}><ScanLine className="w-4 h-4" /> Scanner</button>
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-5 py-3 rounded-xl text-[9px] font-black uppercase tracking-[0.3em] flex items-center gap-2 transition-all shadow-xl border border-red-500/20"><LogOut className="w-4 h-4" /> Exit</button>
         </div>
      </div>

      {tab === 'scan' ? (
         <div className="flex-1 flex items-center justify-center py-12">
            <div className="bg-zinc-900/80 p-10 rounded-[48px] border border-white/10 text-center max-w-sm w-full shadow-2xl backdrop-blur-xl">
               <div className="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-blue-500/20 shadow-lg">
                  <QrCode className="w-10 h-10 text-blue-500" />
               </div>
               <h2 className="text-2xl font-black text-white uppercase tracking-tight mb-3">Work Station</h2>
               <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em] mb-8 opacity-60">Scan Batch Traveler</p>
               <input autoFocus onKeyDown={handleScan} className="bg-black/60 border-2 border-blue-600/50 rounded-2xl px-6 py-5 text-white text-center w-full text-xl font-black tracking-widest focus:border-blue-500 outline-none shadow-inner" placeholder="WAITING..." />
            </div>
         </div>
      ) : tab === 'history' ? (
        <div className="space-y-6">
           {groupedHistory.map(([date, logs]) => (
               <div key={date} className="bg-zinc-900/40 border border-white/10 rounded-[32px] overflow-hidden shadow-2xl backdrop-blur-xl">
                 <div className="p-5 border-b border-white/5 bg-zinc-950/40 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Calendar className="w-4 h-4 text-blue-500"/>
                        <h3 className="font-black text-white uppercase text-[10px] tracking-[0.3em]">{date}</h3>
                    </div>
                    <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest bg-black/40 px-3 py-1 rounded-full border border-white/5 shadow-inner">{logs.length} Entries</span>
                 </div>
                 <div className="overflow-x-auto custom-scrollbar">
                   <table className="w-full text-left">
                     <thead className="bg-zinc-950/20 text-zinc-700 font-black uppercase tracking-[0.3em] text-[8px]"><tr><th className="px-6 py-4">Purchase Order (PO)</th><th className="px-6 py-4">Work Step</th><th className="px-6 py-4">Time Range</th><th className="px-6 py-4 text-right">Elapsed</th></tr></thead>
                     <tbody className="divide-y divide-white/5">
                       {logs.map(log => (
                         <tr key={log.id} className="hover:bg-white/[0.02] transition-colors group">
                           <td className="px-6 py-4">
                                <p className="text-white font-black uppercase tracking-tight text-base leading-none mb-1">{log.jobId}</p>
                                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest">Entry ID: {log.id}</p>
                           </td>
                           <td className="px-6 py-4 text-blue-500 font-black uppercase tracking-widest text-[9px]">{log.operation}</td>
                           <td className="px-6 py-4 text-zinc-500 font-mono text-[10px] uppercase">
                                {new Date(log.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - {log.endTime ? new Date(log.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}
                           </td>
                           <td className="px-6 py-4 text-right text-zinc-400 font-black font-mono text-base leading-none">{formatDuration(log.durationMinutes)}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
           ))}
           {groupedHistory.length === 0 && <div className="p-20 text-center text-zinc-800 font-black uppercase tracking-[0.5em] text-[10px] border-2 border-dashed border-white/5 rounded-[48px]">Log null</div>}
        </div>
      ) : (
        <div className="flex-1 flex flex-col space-y-8 animate-fade-in">
          <div className="relative">
            <Search className="absolute left-5 top-4 w-5 h-5 text-zinc-700" />
            <input type="text" placeholder="FILTER_BATCHES (PO, ID, PART)..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-[28px] pl-14 pr-12 py-4 text-white font-black uppercase tracking-[0.2em] text-[10px] focus:border-blue-600 outline-none backdrop-blur-xl shadow-inner placeholder:text-zinc-800"/>
            {search && (
                <button onClick={() => setSearch('')} className="absolute right-5 top-4.5 text-zinc-600 hover:text-white transition-colors">
                    <X className="w-5 h-5" />
                </button>
            )}
          </div>
          
          {activeLog && (
            <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-red-500 text-[9px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 animate-pulse shadow-xl">
              <AlertCircle className="w-4 h-4" /> Timer active. End current phase to begin another.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredJobs.map(job => (
              <JobSelectionCard key={job.id} job={job} onStart={handleStartJob} disabled={!!activeLog} operations={ops} />
            ))}
            {filteredJobs.length === 0 && <div className="col-span-full py-20 text-center text-zinc-800 font-black uppercase tracking-[0.5em] text-[10px]">Queue null</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// --- COMPONENT: PRINTABLE JOB SHEET ---
const PrintableJobSheet = ({ job, onClose }: { job: Job | null, onClose: () => void }) => {
  if (!job) return null;
  
  const currentBaseUrl = window.location.href.split('?')[0];
  const deepLinkData = `${currentBaseUrl}?jobId=${job.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(deepLinkData)}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/98 backdrop-blur-3xl p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white text-black w-full max-w-4xl rounded-[32px] shadow-2xl relative overflow-hidden flex flex-col max-h-full" id="printable-area-root">
         
         <div className="bg-zinc-950 text-white p-6 flex justify-between items-center no-print shrink-0 border-b border-white/10">
             <div className="flex items-center gap-5">
               <Printer className="w-5 h-5 text-blue-500"/>
               <div>
                 <h3 className="font-black uppercase text-base tracking-tight leading-none">TRAVELER</h3>
                 <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] mt-1.5">Print Hub</p>
               </div>
             </div>
             <div className="flex gap-5 items-center">
                 <button onClick={onClose} className="text-zinc-600 hover:text-white text-[9px] font-black uppercase tracking-[0.3em] transition-all">Abort</button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2 shadow-2xl transition-all active:scale-95">Print Job Traveler</button>
             </div>
         </div>

         <div className="flex-1 p-12 bg-white overflow-hidden flex flex-col justify-between h-full">
            <div>
              <div className="flex justify-between items-end border-b-[6px] border-black pb-6 mb-10">
                <div>
                  <h1 className="text-6xl font-black tracking-tighter leading-none mb-2">SC DEBURRING</h1>
                  <p className="text-xl font-black uppercase tracking-[0.4em] text-gray-500">TRAVELER</p>
                </div>
                <div className="text-right">
                  <h2 className="text-4xl font-black tracking-tighter leading-none">{new Date().toLocaleDateString()}</h2>
                  <p className="text-[10px] font-black text-gray-400 mt-2 uppercase tracking-[0.3em]">PRINTED ON</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-12 mb-10">
                <div className="space-y-8 flex flex-col">
                  <div className="border-[6px] border-black p-8 bg-gray-50/50 shadow-sm">
                    <label className="block text-[10px] uppercase font-black text-gray-400 mb-4 tracking-[0.3em]">PURCHASE ORDER (PO)</label>
                    <div className="text-8xl font-black leading-none break-all tracking-tighter uppercase">{job.poNumber}</div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-8">
                    <div className="border-[3px] border-gray-100 p-6 bg-white shadow-sm">
                      <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-[0.3em]">PART INDEX</label>
                      <div className="text-3xl font-black break-words leading-none uppercase tracking-tighter">{job.partNumber}</div>
                    </div>
                    <div className="border-[3px] border-gray-100 p-6 bg-white shadow-sm">
                      <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-[0.3em]">LOT SIZE</label>
                      <div className="text-4xl font-black leading-none">{job.quantity} <span className="text-xl font-bold text-gray-400">PCS</span></div>
                    </div>
                    <div className="border-[3px] border-gray-100 p-6 bg-white shadow-sm">
                      <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-[0.3em]">DATE RECEIVED</label>
                      <div className="text-2xl font-black leading-none">{formatToMDY(job.dateReceived) || 'N/A'}</div>
                    </div>
                    <div className="border-[3px] border-gray-100 p-6 bg-white shadow-sm">
                      <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-[0.3em]">DUE DATE</label>
                      <div className="text-3xl font-black text-red-600 leading-none">{formatToMDY(job.dueDate) || 'PRIORITY'}</div>
                    </div>
                  </div>

                  <div className="flex-1">
                    <label className="block text-[10px] uppercase font-black text-gray-400 mb-3 tracking-[0.3em]">FLOOR LOGIC / INSTRUCTIONS</label>
                    <div className="text-xl border-l-[12px] border-black pl-8 py-6 bg-gray-50 min-h-[8rem] font-bold italic leading-relaxed text-gray-800">
                      {job.info || "FOLLOW STANDARD DEBURRING PROCEDURES."}
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col items-center justify-center border-[6px] border-black p-10 bg-gray-50 shadow-inner h-full">
                  <div className="bg-white p-4 shadow-xl border border-gray-200">
                    <img src={qrUrl} alt="QR Code" className="w-full h-auto max-w-[100%] block object-contain mix-blend-multiply" crossOrigin="anonymous" />
                  </div>
                  <div className="mt-10 text-center w-full">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.5em] mb-4">BATCH REFERENCE ID</p>
                    <p className="font-mono text-xl font-black break-all text-gray-800 leading-none tracking-widest">{job.id}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-auto border-t-2 border-gray-100 pt-6 flex justify-between items-center text-[10px] font-black text-gray-300 uppercase tracking-[0.5em]">
               <span>SC DEBURRING OPERATIONAL TRAVELER</span>
               <span>BATCH VERIFICATION REQUIRED</span>
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
    <button onClick={() => { setView(id); setIsMobileMenuOpen(false); }} className={`flex items-center gap-4 w-full px-7 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.25em] transition-all group ${view === id ? 'bg-zinc-800 text-white shadow-2xl border border-white/10 translate-x-1.5' : 'text-zinc-600 hover:text-white hover:bg-white/5'}`}><Icon className={`w-5 h-5 transition-transform group-hover:scale-110 ${view === id ? 'text-blue-500' : ''}`} /> {l}</button>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col lg:flex-row font-sans overflow-x-hidden selection:bg-blue-500 selection:text-white">
       <PrintStyles /><PrintableJobSheet job={printable} onClose={() => setPrintable(null)} /><ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
       {user.role === 'admin' && (
          <>
            <div className="lg:hidden bg-zinc-950/80 border-b border-white/5 p-5 flex justify-between items-center sticky top-0 z-40 backdrop-blur-3xl">
               <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-xl"><Sparkles className="w-5 h-5 text-white"/></div><span className="font-black uppercase tracking-tighter text-base">SC DEBURRING</span></div>
               <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-3 bg-zinc-900 border border-white/10 rounded-2xl text-white shadow-xl transition-all active:scale-95">{isMobileMenuOpen ? <X className="w-6 h-6"/> : <Menu className="w-6 h-6"/>}</button>
            </div>
            <aside className={`fixed lg:sticky top-0 inset-y-0 left-0 w-72 border-r border-white/5 bg-zinc-950 flex flex-col z-50 transform transition-transform duration-500 ease-in-out shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
               <div className="p-10 hidden lg:flex flex-col gap-1 border-b border-white/5 mb-8"><div className="flex items-center gap-4"><div className="w-12 h-12 rounded-[20px] bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-2xl border border-blue-500/20"><Sparkles className="w-6 h-6 text-white"/></div><h2 className="font-black text-xl tracking-tighter text-white uppercase leading-none">SC DEBURRING</h2></div></div>
               <nav className="flex-1 px-4 space-y-2 overflow-y-auto py-10 lg:py-0 custom-scrollbar"><NavItem id="admin-dashboard" l="Overview" i={LayoutDashboard} /><NavItem id="admin-jobs" l="Production" i={Briefcase} /><NavItem id="admin-logs" l="Work Logs" i={Calendar} /><NavItem id="admin-team" l="Personnel" i={Users} /><NavItem id="admin-settings" l="Matrix Settings" i={Settings} /><NavItem id="admin-scan" l="Terminal" i={ScanLine} /></nav>
               <div className="p-6 border-t border-white/5 bg-zinc-900/30"><button onClick={() => setUser(null)} className="w-full flex items-center gap-4 px-6 py-4 text-zinc-700 hover:text-red-500 text-[10px] font-black uppercase tracking-[0.3em] transition-all rounded-2xl hover:bg-red-500/5 group"><LogOut className="w-5 h-5 group-hover:scale-110 transition-all" /> Sign Out</button></div>
            </aside>
            {isMobileMenuOpen && <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}
          </>
       )}
       <main className={`flex-1 p-5 md:p-12 w-full max-w-full overflow-x-hidden ${user.role === 'admin' ? '' : 'min-h-screen bg-zinc-950'}`}>
          <div className="max-w-6xl mx-auto">
            {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} />}
            {view === 'admin-jobs' && <JobsView addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} />}
            {view === 'admin-logs' && <LogsView addToast={addToast} confirm={setConfirm} />}
            {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
            {view === 'admin-settings' && <SettingsView addToast={addToast} />}
            {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} />}
            {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} />}
          </div>
       </main>
       <div className="fixed bottom-8 right-0 left-0 md:left-auto md:right-8 z-[9999] pointer-events-none px-6 md:px-0"><div className="pointer-events-auto flex flex-col items-end gap-3 max-w-sm ml-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div>
    </div>
  );
}
