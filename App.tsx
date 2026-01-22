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
              <span className="text-red-400 font-black uppercase tracking-[0.2em] text-[10px] md:text-xs">Live Terminal Active</span>
           </div>
           <h2 className="text-4xl md:text-7xl font-black text-white mb-2 tracking-tighter leading-none uppercase break-all">{job ? job.jobIdsDisplay : 'UNKNOWN_BATCH'}</h2>
           <div className="text-xl md:text-3xl text-blue-400 font-black mb-8"><span className="px-5 py-1.5 bg-blue-500/10 rounded-2xl border border-blue-500/20">{log.operation}</span></div>
           <div className="bg-black/60 rounded-3xl p-6 md:p-8 border border-white/10 mb-8 w-full max-w-md flex items-center justify-between shadow-inner">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.3em] mb-2 opacity-60">Cycle Elapsed</p>
                <div className="text-white text-4xl md:text-6xl font-black tracking-widest leading-none"><LiveTimer startTime={log.startTime} /></div>
              </div>
              <Clock className="w-12 h-12 text-zinc-800" />
           </div>
           <button onClick={handleStop} disabled={isStopping} className="w-full max-w-md bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-8 py-5 rounded-[24px] font-black uppercase tracking-[0.4em] text-sm md:text-base flex items-center justify-center gap-4 shadow-2xl transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer">
              {isStopping ? 'STOPPING...' : <><StopCircle className="w-6 h-6" /> END CURRENT OPERATION</>}
           </button>
        </div>
        <div className="bg-white/[0.03] rounded-[32px] p-6 md:p-10 border border-white/5 flex flex-col h-full backdrop-blur-xl shadow-inner relative">
           <h3 className="text-zinc-500 font-black uppercase text-[10px] mb-8 flex items-center gap-3 tracking-[0.3em]"><Info className="w-4 h-4 text-blue-500" /> Technical Matrix</h3>
           {job ? (
             <div className="grid grid-cols-2 gap-y-10 gap-x-8">
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Part Index</label><div className="text-xl md:text-3xl font-black text-white mt-2 break-words leading-none tracking-tight">{job.partNumber}</div></div>
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Order Ref</label><div className="text-xl md:text-3xl font-black text-white mt-2 break-words leading-none tracking-tight">{job.poNumber}</div></div>
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Lot Size</label><div className="text-xl md:text-3xl font-black text-blue-500 mt-2 leading-none">{job.quantity} <span className="text-xs font-bold text-zinc-600 ml-1">UNITS</span></div></div>
               <div><label className="text-[10px] text-zinc-600 uppercase font-black tracking-widest">Deadline</label><div className="text-xl md:text-3xl font-black text-red-500 mt-2 leading-none">{job.dueDate || 'N/A'}</div></div>
             </div>
           ) : <p className="text-zinc-500 font-black uppercase tracking-widest">DATA_UNAVAILABLE</p>}
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
    if (user) { onLogin(user); addToast('success', `ACCESS_GRANTED: ${user.name}`); }
    else { addToast('error', 'INVALID_CREDENTIALS'); setPin(''); }
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
        <p className="text-center text-zinc-600 text-[10px] font-black uppercase tracking-[0.5em] mb-10 opacity-60">Operations Portal</p>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white font-black uppercase tracking-[0.2em] focus:border-blue-600 outline-none placeholder:text-zinc-800" placeholder="IDENTITY_ID" autoFocus />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white font-black tracking-[1em] focus:border-blue-600 outline-none" placeholder="PIN" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-6 rounded-[28px] font-black uppercase tracking-[0.4em] transition-all shadow-2xl shadow-blue-900/20 mt-4 disabled:opacity-50 active:scale-95">
            {loading ? 'VALIDATING...' : 'INIT_SESSION'}
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

   return (
      <div className="space-y-8 animate-fade-in">
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Live Floor</p>
                   <h3 className="text-5xl font-black text-white leading-none tracking-tighter">{liveJobsCount}</h3>
               </div>
               <Activity className={`w-12 h-12 text-blue-500 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-10'}`} />
            </div>
            <div className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Open Pipeline</p>
                   <h3 className="text-5xl font-black text-white leading-none tracking-tighter">{wipJobsCount}</h3>
               </div>
               <Briefcase className="text-zinc-800 w-12 h-12" />
            </div>
            <div className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex justify-between items-center shadow-2xl backdrop-blur-xl">
               <div>
                   <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Personnel</p>
                   <h3 className="text-5xl font-black text-white leading-none tracking-tighter">{activeWorkersCount}</h3>
               </div>
               <Users className="text-emerald-500/50 w-12 h-12" />
            </div>
         </div>
         
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-xl">
                <div className="p-8 border-b border-white/5 bg-zinc-950/40 flex items-center justify-between">
                    <h3 className="font-black text-white flex items-center gap-4 uppercase text-sm tracking-[0.2em]"><Activity className="w-5 h-5 text-emerald-500"/> Real-time Ops</h3>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar">
                   {activeLogs.map(l => (
                      <div key={l.id} className="p-6 flex items-center justify-between hover:bg-white/[0.02] transition-colors">
                         <div className="flex items-center gap-5">
                            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center font-black text-zinc-500 border border-white/5 text-sm shadow-inner uppercase">{l.userName.charAt(0)}</div>
                            <div>
                                <p className="font-black text-white uppercase text-sm">{l.userName}</p>
                                <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest mt-1">Batch: {l.jobId} • {l.operation}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-6">
                            <div className="text-white text-2xl font-black font-mono tracking-tighter"><LiveTimer startTime={l.startTime} /></div>
                            <button onClick={() => confirmAction({ title: "Force Stop", message: "Hard-stop this worker's timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-3 rounded-xl hover:bg-red-500 transition-all"><Power className="w-4 h-4" /></button>
                         </div>
                      </div>
                   ))}
                   {activeLogs.length === 0 && <div className="p-12 text-center text-zinc-700 text-xs font-black uppercase tracking-widest">Floor status idle</div>}
                </div>
             </div>
             <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-xl">
                <div className="p-8 border-b border-white/5 bg-zinc-950/40 flex justify-between items-center">
                    <h3 className="font-black text-white flex items-center gap-4 uppercase text-sm tracking-[0.2em]"><History className="w-5 h-5 text-blue-500"/> Recent Events</h3>
                    <button onClick={() => setView('admin-logs')} className="text-[9px] font-black text-blue-500 uppercase tracking-widest hover:text-white transition-colors">Archive</button>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar">
                   {logs.map(l => (
                       <div key={l.id} className="p-6 flex items-start gap-5 hover:bg-white/[0.02] transition-colors">
                           <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-800' : 'bg-emerald-500 animate-pulse'}`}></div>
                           <div className="flex-1">
                               <p className="text-sm text-white font-black uppercase leading-tight">
                                   {l.userName} <span className="text-zinc-600">{l.endTime ? 'finished' : 'started'}</span> <span className="text-blue-500">{l.operation}</span>
                               </p>
                               <p className="text-[10px] text-zinc-600 font-black tracking-widest mt-1 uppercase">Batch: {l.jobId}</p>
                           </div>
                       </div>
                   ))}
                   {logs.length === 0 && <div className="p-12 text-center text-zinc-700 text-xs font-black uppercase tracking-widest">No recent data</div>}
                </div>
             </div>
         </div>
      </div>
   );
};

// --- ADMIN: JOBS ---
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
    if (!editingJob.jobIdsDisplay || !editingJob.partNumber) return addToast('error', 'REQUIRED_FIELDS_MISSING');
    setIsSaving(true);
    await DB.saveJob({ id: editingJob.id || Date.now().toString(), jobIdsDisplay: editingJob.jobIdsDisplay, poNumber: editingJob.poNumber || '', partNumber: editingJob.partNumber, quantity: editingJob.quantity || 0, dueDate: editingJob.dueDate || '', info: editingJob.info || '', status: editingJob.status || 'pending', dateReceived: editingJob.dateReceived || new Date().toISOString().split('T')[0], createdAt: editingJob.createdAt || Date.now() } as Job);
    addToast('success', 'BATCH_RECORDS_UPDATED'); setShowModal(false); setIsSaving(false);
   };

   return (
      <div className="space-y-8 animate-fade-in">
         <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-8">
            <div>
               <h2 className="text-5xl font-black uppercase tracking-tighter text-white leading-none mb-4">Floor Management</h2>
               <div className="flex gap-4 p-1.5 bg-zinc-900/60 border border-white/5 rounded-2xl w-fit backdrop-blur-xl shadow-lg">
                  <button onClick={() => setSubTab('active')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${subTab === 'active' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Active Production</button>
                  <button onClick={() => setSubTab('archive')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${subTab === 'archive' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Completed Records</button>
               </div>
            </div>
            <div className="flex gap-4 flex-wrap lg:justify-end items-center">
                {subTab === 'archive' && (
                    <div className="flex gap-2 p-1 bg-black/40 border border-white/5 rounded-xl mr-2 shadow-inner">
                        {['week', 'month', 'year', 'all'].map(t => <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${timeFilter === t ? 'bg-zinc-800 text-blue-400' : 'text-zinc-600 hover:text-zinc-400'}`}>{t}</button>)}
                    </div>
                )}
                <div className="relative flex-1 lg:flex-initial shadow-2xl">
                    <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-700" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="FILTER_BATCHES..." className="pl-14 pr-6 py-4 bg-zinc-900 border border-white/5 rounded-[24px] text-[10px] font-black uppercase tracking-[0.3em] text-white w-full lg:w-80 outline-none backdrop-blur-xl" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-8 py-4 rounded-[24px] text-[10px] font-black uppercase tracking-[0.4em] text-white flex items-center gap-3 hover:bg-blue-500 shadow-2xl transition-all"><Plus className="w-5 h-5"/> New Batch</button>
            </div>
         </div>

         <div className="grid grid-cols-1 gap-6">
            {filteredJobs.map(j => (
               <div key={j.id} className="bg-zinc-900/40 border border-white/10 rounded-[40px] p-8 md:p-10 flex flex-col md:flex-row justify-between items-center group shadow-2xl hover:bg-zinc-900/60 transition-all border-l-[8px] border-l-blue-500/20">
                  <div className="flex-1 w-full space-y-4">
                     <div className="flex items-center gap-4">
                        <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${j.status === 'in-progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-[0_0_15px_#3b82f622]' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>{j.status}</span>
                        <span className="text-zinc-600 font-black text-[10px] uppercase tracking-widest">SEQ: {j.jobIdsDisplay}</span>
                     </div>
                     <h3 className="text-4xl md:text-5xl font-black text-white leading-none tracking-tighter break-all uppercase">{j.poNumber}</h3>
                     <div className="flex flex-wrap gap-8 pt-2">
                        <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Part Index</p><p className="text-lg font-black text-zinc-400 uppercase tracking-tighter">{j.partNumber}</p></div>
                        <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Load Size</p><p className="text-2xl font-black text-blue-500 font-mono">{j.quantity} PCS</p></div>
                        <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Floor Target</p><p className="text-lg font-black text-red-600 underline underline-offset-4">{j.dueDate || 'PRIORITY'}</p></div>
                     </div>
                  </div>
                  <div className="flex gap-3 mt-8 md:mt-0 opacity-40 group-hover:opacity-100 transition-all">
                     {j.status !== 'completed' ? (
                        <button onClick={() => confirm({ title: "Finalize Production", message: "Archive this batch?", onConfirm: () => DB.completeJob(j.id) })} className="p-4 bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all shadow-lg border border-emerald-500/20"><CheckCircle className="w-6 h-6"/></button>
                     ) : (
                        <button onClick={() => confirm({ title: "Reactivate Batch", message: "Move batch back to active floor?", onConfirm: () => DB.reopenJob(j.id) })} className="p-4 bg-blue-500/10 text-blue-500 rounded-2xl hover:bg-blue-500 hover:text-white transition-all shadow-lg border border-blue-500/20"><RotateCcw className="w-6 h-6"/></button>
                     )}
                     <button onClick={() => setPrintable(j)} className="p-4 bg-zinc-800 text-zinc-500 rounded-2xl hover:bg-zinc-700 hover:text-white transition-all shadow-lg border border-white/5"><Printer className="w-6 h-6"/></button>
                     <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-4 bg-blue-500/10 text-blue-400 rounded-2xl hover:bg-blue-500 hover:text-white transition-all shadow-lg border border-blue-500/20"><Edit2 className="w-6 h-6"/></button>
                     <button onClick={() => confirm({ title: "Purge Record", message: "Permanently erase batch data?", onConfirm: () => DB.deleteJob(j.id) })} className="p-4 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-600 hover:text-white transition-all shadow-lg border border-red-500/20"><Trash2 className="w-6 h-6"/></button>
                  </div>
               </div>
            ))}
            {filteredJobs.length === 0 && <div className="py-24 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.5em] opacity-40">Section null</div>}
         </div>

         {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
               <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-[64px] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] p-10">
                  <div className="flex justify-between items-center mb-10"><h3 className="font-black text-white uppercase text-2xl tracking-tight leading-none">Job Matrix Configuration</h3><button onClick={() => setShowModal(false)} className="p-4 bg-white/5 rounded-2xl text-zinc-600 hover:text-white"><X className="w-6 h-6" /></button></div>
                  <div className="space-y-8 max-h-[60vh] overflow-y-auto custom-scrollbar pr-4">
                     <div className="space-y-2"><label className="text-[10px] text-blue-500 font-black uppercase tracking-[0.3em] ml-2">Purchase Order Ref</label><input className="w-full bg-black/60 border-2 border-white/5 rounded-[24px] p-6 text-white text-3xl font-black outline-none tracking-tight uppercase focus:border-blue-600 transition-all shadow-inner" placeholder="PO_---" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} /></div>
                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Job Index</label><input className="w-full bg-black/30 border border-white/5 rounded-[24px] p-5 text-sm font-black text-white shadow-inner uppercase tracking-widest" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Part Catalog #</label><input className="w-full bg-black/30 border border-white/5 rounded-[24px] p-5 text-sm font-black text-white shadow-inner uppercase tracking-widest" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
                     </div>
                     <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Batch Load</label><input type="number" className="w-full bg-black/30 border border-white/5 rounded-[24px] p-5 text-lg font-black text-blue-500 shadow-inner" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                        <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Floor Target</label><input type="date" className="w-full bg-zinc-800 border border-white/5 rounded-[24px] p-5 text-white text-xs font-black uppercase shadow-inner" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
                     </div>
                     <div className="space-y-2"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Instructions / Logic</label><textarea className="w-full bg-black/30 border border-white/5 rounded-[32px] p-6 text-xs text-zinc-400 italic shadow-inner" rows={4} placeholder="Specialized processing notes..." value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
                  </div>
                  <div className="mt-10 flex justify-end gap-5"><button onClick={() => setShowModal(false)} className="px-8 py-4 text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all">Discard</button><button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95">{isSaving ? 'SYNCING...' : 'COMMIT_DATA'}</button></div>
               </div>
            </div>
         )}
      </div>
   );
};

// --- ADMIN: LOGS (INDIVIDUALIZED JOB BOXES) ---
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
     
     return Object.entries(groups).sort((a,b) => {
        const timeA = a[1].logs[0]?.startTime || 0;
        const timeB = b[1].logs[0]?.startTime || 0;
        return timeB - timeA;
     });
   }, [logs, jobs, timeFilter, search]);

   const handleSaveLog = async () => {
       if (editingLog) { await DB.updateTimeLog(editingLog); addToast('success', 'ARCHIVE_SYNCED'); setEditingLog(null); }
   };

   return (
      <div className="space-y-10 animate-fade-in">
         <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-8">
            <div>
               <h2 className="text-5xl font-black uppercase tracking-tighter text-white leading-none mb-4">Batch Archives</h2>
               <div className="flex gap-4 p-1.5 bg-zinc-900/60 border border-white/5 rounded-2xl w-fit backdrop-blur-xl shadow-lg">
                  {['week', 'month', 'year', 'all'].map(t => <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-[0.3em] transition-all ${timeFilter === t ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>{t}</button>)}
               </div>
            </div>
            <div className="relative flex-1 lg:flex-initial shadow-2xl">
                <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-700" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="FILTER_SYSTEM_ARCHIVE..." className="pl-14 pr-6 py-4 bg-zinc-900 border border-white/5 rounded-[24px] text-[10px] font-black uppercase tracking-[0.3em] text-white w-full lg:w-96 outline-none backdrop-blur-xl shadow-inner" />
            </div>
         </div>

         <div className="space-y-12">
            {groupedLogs.map(([jobId, data]) => (
               <div key={jobId} className="bg-zinc-900/40 border border-white/10 rounded-[56px] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl border-t-[10px] border-t-blue-500/30">
                  {/* Job Box Header - Full Details */}
                  <div className="p-10 md:p-12 border-b border-white/5 bg-zinc-950/40 flex flex-col md:flex-row justify-between items-start md:items-center gap-10">
                     <div className="flex-1 w-full space-y-4">
                        <div className="flex items-center gap-4">
                           <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em] bg-blue-500/10 px-4 py-1.5 rounded-full border border-blue-500/20 shadow-[0_0_15px_#3b82f611]">Job Sequence</span>
                           <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">Ref Index: {jobId}</span>
                        </div>
                        <h3 className="text-4xl md:text-6xl font-black text-white uppercase tracking-tighter break-all leading-none">{data.job?.poNumber || 'DATA_NOT_FOUND'}</h3>
                        <div className="flex flex-wrap gap-x-10 gap-y-4 pt-4 border-t border-white/5">
                           <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] mb-1">Technical Part Index</p><p className="text-xl font-black text-zinc-300 uppercase tracking-tighter leading-none">{data.job?.partNumber || '---'}</p></div>
                           <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] mb-1">Batch Load Units</p><p className="text-xl font-black text-zinc-400 font-mono leading-none">{data.job?.quantity || '0'} PCS</p></div>
                           <div><p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] mb-1">Job Status State</p><p className="text-xl font-black text-zinc-500 uppercase tracking-tighter leading-none">{data.job?.status || 'N/A'}</p></div>
                        </div>
                     </div>
                     <div className="text-right w-full md:w-auto bg-black/40 p-8 rounded-[40px] border border-white/5 shadow-inner flex flex-col items-center md:items-end">
                        <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.5em] mb-3 opacity-60">Total Cumulative Hours</p>
                        <div className="text-5xl md:text-7xl font-black text-white font-mono leading-none tracking-widest">{formatDuration(data.totalMins)}</div>
                     </div>
                  </div>

                  {/* Individual Logs List for this Job Box */}
                  <div className="overflow-x-auto custom-scrollbar">
                     <table className="w-full text-left border-collapse">
                        <thead className="bg-zinc-950/20 text-zinc-600 font-black uppercase tracking-[0.4em] text-[10px]">
                           <tr>
                              <th className="p-10">Production Date</th>
                              <th className="p-10">Floor Operator</th>
                              <th className="p-10">Workflow Phase</th>
                              <th className="p-10">Shift Duration</th>
                              <th className="p-10 text-right">Audit</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                           {data.logs.map(l => (
                              <tr key={l.id} className="hover:bg-white/[0.03] transition-all group">
                                 <td className="p-10 text-zinc-500 font-black text-sm uppercase whitespace-nowrap">{new Date(l.startTime).toLocaleDateString()}</td>
                                 <td className="p-10">
                                    <div className="flex items-center gap-5">
                                       <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center font-black text-zinc-600 border border-white/5 text-xs shadow-inner uppercase group-hover:border-blue-500/50 transition-colors">{l.userName.charAt(0)}</div>
                                       <span className="text-white font-black uppercase tracking-tight text-lg leading-none">{l.userName}</span>
                                    </div>
                                 </td>
                                 <td className="p-10 text-blue-500 font-black uppercase text-xs tracking-[0.2em]">{l.operation}</td>
                                 <td className="p-10">
                                    <div className="text-zinc-300 font-black font-mono text-xl leading-none">{formatDuration(l.durationMinutes)}</div>
                                    <p className="text-[9px] text-zinc-700 font-black uppercase mt-2 tracking-widest">
                                       {new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - {l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'ACTIVE'}
                                    </p>
                                 </td>
                                 <td className="p-10 text-right"><button onClick={() => setEditingLog({...l})} className="p-5 bg-zinc-800 rounded-[24px] text-zinc-600 hover:text-white transition-all shadow-xl hover:bg-zinc-700"><Edit2 className="w-5 h-5"/></button></td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               </div>
            ))}
            {groupedLogs.length === 0 && <div className="py-32 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.6em] opacity-40">System archive is empty for this period</div>}
         </div>

         {/* Log Editing Modal */}
         {editingLog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
               <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-[64px] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] p-10 overflow-hidden">
                  <div className="flex justify-between items-center mb-10"><h3 className="font-black text-white uppercase text-xl tracking-tight leading-none">Modify Archive Entry</h3><button onClick={() => setEditingLog(null)} className="p-4 bg-white/5 rounded-2xl text-zinc-600 hover:text-white"><X className="w-6 h-6" /></button></div>
                  <div className="space-y-8">
                     <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] ml-2 block">Phase Start</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-xs font-black uppercase tracking-widest shadow-inner outline-none focus:border-blue-600 transition-all" value={toDateTimeLocal(editingLog.startTime)} onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})} /></div>
                        <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] ml-2 block">Phase End</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-xs font-black uppercase tracking-widest shadow-inner outline-none focus:border-blue-600 transition-all" value={toDateTimeLocal(editingLog.endTime)} onChange={e => setEditingLog({...editingLog, endTime: e.target.value ? new Date(e.target.value).getTime() : null})} /></div>
                     </div>
                  </div>
                  <div className="mt-12 flex justify-end gap-5"><button onClick={() => setEditingLog(null)} className="px-8 py-4 text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all">Abort</button><button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95">Commit Sync</button></div>
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
     if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'IDENTITY_DATA_MISSING');
     DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true });
     setShowModal(false); addToast('success', 'IDENTITY_SYNCED');
   };
   return (
     <div className="space-y-10 animate-fade-in">
        <div className="flex justify-between items-center"><h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">Global Personnel</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-[24px] flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl transition-all active:scale-95"><Plus className="w-5 h-5" /> Recruit Personnel</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {users.map(u => (
            <div key={u.id} className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex items-center justify-between shadow-2xl backdrop-blur-xl group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-[24px] bg-zinc-800 flex items-center justify-center text-zinc-500 font-black border border-white/10 text-xl shadow-inner group-hover:text-blue-500 uppercase">{u.name.charAt(0)}</div>
                <div><p className="font-black text-white text-xl tracking-tight leading-none mb-1.5 uppercase">{u.name}</p><p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">@{u.username} • {u.role}</p></div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => confirm({ title: "Revoke Access", message: "Permanently erase identity?", onConfirm: () => DB.deleteUser(u.id) })} className="p-4 hover:bg-red-500/10 text-zinc-700 hover:text-red-500 transition-all rounded-2xl"><Trash2 className="w-5 h-5" /></button>
                 <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-4 hover:bg-white/5 text-zinc-600 hover:text-white transition-all rounded-2xl"><Edit2 className="w-5 h-5" /></button>
              </div>
            </div>
          ))}
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4">
             <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[56px] shadow-2xl p-10">
                <div className="flex justify-between items-center mb-10 leading-none"><h3 className="font-bold text-white text-xl uppercase tracking-tight">Personnel Matrix</h3><button onClick={() => setShowModal(false)} className="p-3 bg-white/5 rounded-2xl text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button></div>
                <div className="space-y-6">
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Full Legal Name</label><input className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all uppercase" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">System Handle</label><input className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Access Cipher (PIN)</label><input type="text" className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all tracking-[0.5em]" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Security Privilege</label><select className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold outline-none" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
                </div>
                <div className="p-10 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-3 mt-8"><button onClick={() => setShowModal(false)} className="text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-widest">Abort</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-[20px] text-[10px] font-black uppercase tracking-[0.3em] transition-all active:scale-95">Sync Profile</button></div>
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
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'CORE_PROTOCOLS_SYNCED'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   const handleDeleteOp = (op: string) => { setSettings({...settings, customOperations: (settings.customOperations || []).filter(o => o !== op)}); };
   return (
     <div className="max-w-2xl space-y-12 animate-fade-in">
        <h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">System Architecture</h2>
        <div className="bg-zinc-900/40 border border-white/10 rounded-[56px] p-10 md:p-12 space-y-12 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-6 border-b border-white/10 pb-12"><div className="bg-blue-600/10 p-5 rounded-[32px] text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)] border border-blue-500/20"><Activity className="w-10 h-10" /></div><div><h3 className="font-black text-white uppercase text-xl tracking-tight">Phase Matrix Definitions</h3><p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-2">Workflow Phase Sequence Controls</p></div></div>
            <div className="space-y-8">
                <div className="flex gap-4"><input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="Register new production phase..." className="flex-1 bg-black/50 border border-white/5 rounded-[24px] px-8 py-5 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all uppercase placeholder-zinc-800" onKeyDown={e => e.key === 'Enter' && handleAddOp()} /><button onClick={handleAddOp} className="bg-blue-600 px-8 rounded-[24px] text-white font-black hover:bg-blue-500 transition-all active:scale-95 shadow-2xl"><Plus className="w-8 h-8" /></button></div>
                <div className="flex flex-wrap gap-4">{(settings.customOperations || []).map(op => <div key={op} className="bg-zinc-950 border border-white/5 px-6 py-4 rounded-[20px] flex items-center gap-5 group hover:border-blue-500/50 transition-all shadow-inner"><span className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400 group-hover:text-white transition-colors">{op}</span><button onClick={() => handleDeleteOp(op)} className="text-zinc-800 hover:text-red-500 transition-colors"><X className="w-5 h-5" /></button></div>)}</div>
            </div>
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-14 py-6 rounded-[32px] font-black uppercase tracking-[0.5em] shadow-[0_48px_128px_-32px_rgba(37,99,235,0.5)] flex items-center gap-4 transition-all active:scale-95 text-xs"><Save className="w-7 h-7" /> COMMENCE CORE SYNC</button></div>
     </div>
   );
};

// --- COMPONENT: CONFIRMATION MODAL ---
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-3xl p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[48px] p-10 shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)]">
        <h3 className="text-xl font-black text-white mb-4 flex items-center gap-4 uppercase tracking-tighter"><AlertTriangle className="text-red-500 w-6 h-6" /> {title}</h3>
        <p className="text-zinc-500 text-[11px] font-black uppercase tracking-widest leading-relaxed mb-10">{message}</p>
        <div className="flex justify-end gap-6">
          <button onClick={onCancel} className="text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.3em] transition-all">Abort</button>
          <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 hover:bg-red-500 text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl transition-all active:scale-95">Confirm_Action</button>
        </div>
      </div>
    </div>
  );
};

// --- HELPER: JOB SELECTION CARD ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-zinc-900/40 border border-white/5 rounded-[32px] overflow-hidden transition-all duration-500 ${expanded ? 'border-blue-500/50 bg-zinc-900/80 shadow-[0_0_40px_rgba(59,130,246,0.1)]' : 'hover:bg-zinc-900/60'} ${disabled ? 'opacity-30 pointer-events-none grayscale' : ''} shadow-2xl backdrop-blur-xl`}>
      <div className="p-8 cursor-pointer group" onClick={() => setExpanded(!expanded)}>
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-2xl font-black text-white tracking-tighter uppercase">{job.jobIdsDisplay}</h3>
          <span className="bg-black/40 border border-white/5 text-blue-500 text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-inner">{job.quantity} PCS</span>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Part Index: <span className="text-zinc-400">{job.partNumber}</span></p>
          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Order Ref: <span className="text-zinc-500">{job.poNumber}</span></p>
        </div>
        
        {!expanded && (
          <div className="mt-6 flex items-center text-blue-500 text-[9px] font-black uppercase tracking-[0.4em] opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
            Initialize_Sequence <ArrowRight className="w-3 h-3 ml-2" />
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-8 bg-black/40 border-t border-white/5 animate-slide-in-bottom">
          <p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] mb-6 flex items-center gap-2"><Settings className="w-3 h-3 text-blue-500"/> Select Workflow Phase</p>
          <div className="grid grid-cols-2 gap-4">
            {operations.map(op => (
              <button
                key={op}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(job.id, op);
                }}
                className="bg-zinc-800/50 hover:bg-blue-600 text-zinc-400 hover:text-white border border-white/5 py-4 px-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-inner active:scale-95"
              >
                {op}
              </button>
            ))}
             {operations.length === 0 && <p className="col-span-2 text-[10px] text-zinc-700 font-black uppercase text-center py-4 tracking-widest italic">Phase matrix empty</p>}
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
        addToast('error', 'INIT_FAILED');
    }
  };

  const handleStopJob = async (logId: string) => {
    try {
      await DB.stopTimeLog(logId);
      addToast('success', 'CYCLE_TERMINATED');
    } catch (e) {
      addToast('error', 'TERMINATION_ERROR');
    }
  };

  const handleScan = (e: any) => {
      if (e.key === 'Enter') {
          let val = e.currentTarget.value.trim();
          const match = val.match(/[?&]jobId=([^&]+)/);
          if (match) val = match[1];
          setSearch(val); 
          setTab('jobs'); 
          addToast('success', 'SCAN_SUCCESS');
      }
  }

  const filteredJobs = jobs.filter(j => 
    JSON.stringify(j).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-10 max-w-6xl mx-auto h-full flex flex-col pb-20 animate-fade-in">
      {activeLog && (
        <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} />
      )}

      <div className="flex flex-wrap gap-4 justify-between items-center bg-zinc-900/60 backdrop-blur-2xl p-4 rounded-[32px] border border-white/5 shadow-2xl no-print">
         <div className="flex gap-4 p-1 bg-black/40 rounded-2xl border border-white/5 shadow-inner">
           <button onClick={() => setTab('jobs')} className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${tab === 'jobs' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Queue</button>
           <button onClick={() => setTab('history')} className={`px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all flex items-center gap-3 ${tab === 'history' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}><History className="w-4 h-4" /> Activity</button>
         </div>
         <div className="flex items-center gap-4">
             <button onClick={() => setTab('scan')} className={`px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3 transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow-xl' : 'bg-zinc-800 text-blue-500 hover:bg-blue-600 hover:text-white shadow-2xl'}`}><ScanLine className="w-5 h-5" /> Optical_Scan</button>
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3 transition-all shadow-2xl border border-red-500/20"><LogOut className="w-5 h-5" /> Terminate_Session</button>
         </div>
      </div>

      {tab === 'scan' ? (
         <div className="flex-1 flex items-center justify-center py-20 animate-fade-in">
            <div className="bg-zinc-900/80 p-12 rounded-[56px] border border-white/10 text-center max-w-md w-full shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] backdrop-blur-xl">
               <div className="w-24 h-24 bg-blue-600/10 rounded-[32px] flex items-center justify-center mx-auto mb-10 border border-blue-500/20 shadow-[0_0_40px_rgba(59,130,246,0.2)]">
                  <QrCode className="w-12 h-12 text-blue-500" />
               </div>
               <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-4 leading-none">Optical Input</h2>
               <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.4em] mb-10 opacity-60">Scan Batch Traveler</p>
               <input autoFocus onKeyDown={handleScan} className="bg-black/60 border-2 border-blue-600/50 rounded-[24px] px-8 py-6 text-white text-center w-full text-xl font-black tracking-widest focus:border-blue-500 outline-none shadow-inner" placeholder="READY_FOR_SCAN..." />
            </div>
         </div>
      ) : tab === 'history' ? (
        <div className="bg-zinc-900/40 border border-white/10 rounded-[56px] overflow-hidden shadow-2xl backdrop-blur-xl animate-fade-in">
          <div className="p-10 border-b border-white/5 bg-zinc-950/40 flex items-center gap-4">
             <div className="w-10 h-10 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-500 border border-blue-500/20 shadow-lg"><History className="w-5 h-5"/></div>
             <h3 className="font-black text-white uppercase text-sm tracking-[0.3em]">Personal Production Log</h3>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left">
              <thead className="bg-zinc-950/20 text-zinc-700 font-black uppercase tracking-[0.4em] text-[10px]"><tr><th className="p-10">Timestamp</th><th className="p-10">Batch Index</th><th className="p-10">Phase</th><th className="p-10 text-right">Cycle_Time</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {myHistory.map(log => (
                  <tr key={log.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="p-10 text-zinc-500 font-black text-xs uppercase">{new Date(log.startTime).toLocaleDateString()} • {new Date(log.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                    <td className="p-10 text-white font-black uppercase tracking-tight text-lg">{log.jobId}</td>
                    <td className="p-10 text-blue-500 font-black uppercase tracking-widest text-[11px]">{log.operation}</td>
                    <td className="p-10 text-right text-zinc-400 font-black font-mono text-xl">{formatDuration(log.durationMinutes)}</td>
                  </tr>
                ))}
                {myHistory.length === 0 && <tr><td colSpan={4} className="p-20 text-center text-zinc-800 font-black uppercase tracking-[0.5em] text-xs">Section_Null</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col animate-fade-in space-y-10">
          <div className="relative shadow-2xl">
            <Search className="absolute left-6 top-5 w-6 h-6 text-zinc-700" />
            <input type="text" placeholder="FILTER_LIVE_QUEUE..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-[32px] pl-16 pr-8 py-6 text-white font-black uppercase tracking-[0.2em] text-sm focus:border-blue-600 outline-none backdrop-blur-xl shadow-inner placeholder:text-zinc-800"/>
          </div>
          
          {activeLog && (
            <div className="p-6 rounded-[28px] bg-red-500/5 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-4 animate-pulse shadow-xl">
              <AlertCircle className="w-5 h-5" /> Exclusive sequence active. Terminate current cycle to proceed.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredJobs.map(job => (
              <JobSelectionCard key={job.id} job={job} onStart={handleStartJob} disabled={!!activeLog} operations={ops} />
            ))}
            {filteredJobs.length === 0 && <div className="col-span-full py-32 text-center text-zinc-800 font-black uppercase tracking-[0.5em] text-xs">Queue empty for current filter</div>}
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in overflow-y-auto no-print">
      <div className="bg-white text-black w-full max-w-3xl rounded-[40px] shadow-2xl relative overflow-hidden flex flex-col max-h-full" id="printable-area-root">
         
         <div className="bg-zinc-950 text-white p-8 flex justify-between items-center no-print shrink-0 border-b border-white/10">
             <div>
               <h3 className="font-black flex items-center gap-4 text-xl uppercase tracking-tighter"><Printer className="w-6 h-6 text-blue-500"/> Traveler Preview</h3>
               <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mt-2">Verify technical data before print</p>
             </div>
             <div className="flex gap-6">
                 <button onClick={onClose} className="text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all">Abort</button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.4em] flex items-center gap-3 shadow-2xl transition-all active:scale-95"><Printer className="w-5 h-5"/> Print_Traveler</button>
             </div>
         </div>

         <div className="flex-1 p-12 bg-white overflow-auto">
            <div className="flex justify-between items-end border-b-[8px] border-black pb-8 mb-12">
              <div>
                 <h1 className="text-6xl font-black tracking-tighter leading-none">SC DEBURRING</h1>
                 <p className="text-xs font-black uppercase tracking-[0.6em] text-gray-400 mt-4">Operations Production Traveler</p>
              </div>
              <div className="text-right">
                 <h2 className="text-3xl font-black font-mono leading-none">{new Date().toLocaleDateString()}</h2>
                 <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-2">Genesis_Timestamp</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12 mb-12">
               <div className="space-y-10">
                   <div className="border-[6px] border-black p-8">
                      <label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Order Reference (PO)</label>
                      <div className="text-6xl font-black leading-none break-all uppercase tracking-tighter">{job.poNumber}</div>
                   </div>
                   <div className="grid grid-cols-2 gap-8">
                      <div className="border-[4px] border-gray-200 p-6">
                         <label className="block text-[9px] uppercase font-black text-gray-400 mb-1 tracking-widest">Part Catalog</label>
                         <div className="text-2xl font-black break-words uppercase">{job.partNumber}</div>
                      </div>
                      <div className="border-[4px] border-gray-200 p-6">
                         <label className="block text-[9px] uppercase font-black text-gray-400 mb-1 tracking-widest">Lot Size</label>
                         <div className="text-2xl font-black">{job.quantity} PCS</div>
                      </div>
                      <div className="border-[4px] border-gray-200 p-6">
                         <label className="block text-[9px] uppercase font-black text-gray-400 mb-1 tracking-widest">Ingress Date</label>
                         <div className="text-xl font-black">{job.dateReceived || '---'}</div>
                      </div>
                      <div className="border-[4px] border-gray-200 p-6">
                         <label className="block text-[9px] uppercase font-black text-gray-400 mb-1 tracking-widest">Floor Target</label>
                         <div className="text-xl font-black text-red-600 underline underline-offset-4">{job.dueDate || '---'}</div>
                      </div>
                   </div>
                   <div>
                     <label className="block text-[10px] uppercase font-black text-gray-400 mb-3 tracking-widest">Logic Instructions</label>
                     <div className="text-lg font-medium border-l-[10px] border-black pl-8 py-6 bg-gray-50 min-h-[8rem] leading-relaxed italic text-gray-700">
                       {job.info || "No specialized processing requirements."}
                     </div>
                   </div>
               </div>
               
               <div className="flex flex-col items-center justify-center border-[8px] border-black p-12 bg-gray-50">
                  <img src={qrUrl} alt="QR Code" className="w-full h-auto mix-blend-multiply" crossOrigin="anonymous" />
                  <p className="font-mono text-xl mt-10 text-gray-400 font-black tracking-widest uppercase">{job.id}</p>
                  <p className="font-black uppercase tracking-[0.5em] text-2xl mt-4 border-t-2 border-black pt-4">Optical_Sync_Node</p>
               </div>
            </div>
            
            <div className="mt-20 border-t-2 border-dashed border-gray-200 pt-10 grid grid-cols-3 gap-10">
                <div className="h-24 border-2 border-gray-100 p-4"><p className="text-[8px] font-black text-gray-300 uppercase tracking-widest">QC_SIG_A</p></div>
                <div className="h-24 border-2 border-gray-100 p-4"><p className="text-[8px] font-black text-gray-300 uppercase tracking-widest">QC_SIG_B</p></div>
                <div className="h-24 border-2 border-gray-100 p-4"><p className="text-[8px] font-black text-gray-300 uppercase tracking-widest">FLOOR_AUTH</p></div>
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
       <PrintStyles /><PrintableJobSheet job={printable} onClose={() => setPrintable(null)} /><ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
       {user.role === 'admin' && (
          <>
            <div className="lg:hidden bg-zinc-950/80 border-b border-white/5 p-6 flex justify-between items-center sticky top-0 z-40 backdrop-blur-3xl">
               <div className="flex items-center gap-4"><div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-2xl"><Sparkles className="w-6 h-6 text-white"/></div><span className="font-black uppercase tracking-tighter text-lg">SC DEBURRING</span></div>
               <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-4 bg-zinc-900 border border-white/10 rounded-3xl text-white shadow-2xl transition-all active:scale-95">{isMobileMenuOpen ? <X className="w-7 h-7"/> : <Menu className="w-7 h-7"/>}</button>
            </div>
            <aside className={`fixed lg:sticky top-0 inset-y-0 left-0 w-80 border-r border-white/5 bg-zinc-950 flex flex-col z-50 transform transition-transform duration-700 ease-in-out shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
               <div className="p-12 hidden lg:flex flex-col gap-1 border-b border-white/5 mb-10"><div className="flex items-center gap-5"><div className="w-14 h-14 rounded-[22px] bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-2xl border border-blue-500/20"><Sparkles className="w-8 h-8 text-white"/></div><h2 className="font-black text-2xl tracking-tighter text-white uppercase leading-none">SC DEBURRING</h2></div><p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.6em] mt-4 opacity-60">System Core_v3.2</p></div>
               <nav className="flex-1 px-5 space-y-3.5 overflow-y-auto py-12 lg:py-0 custom-scrollbar"><NavItem id="admin-dashboard" l="Floor Overview" i={LayoutDashboard} /><NavItem id="admin-jobs" l="Production Batches" i={Briefcase} /><NavItem id="admin-logs" l="Global Archive" i={Calendar} /><NavItem id="admin-team" l="Human Resources" i={Users} /><NavItem id="admin-settings" l="Core Protocols" i={Settings} /><NavItem id="admin-scan" l="Floor Terminal" i={ScanLine} /></nav>
               <div className="p-8 border-t border-white/5 bg-zinc-900/30"><button onClick={() => setUser(null)} className="w-full flex items-center gap-5 px-8 py-5 text-zinc-700 hover:text-red-500 text-[11px] font-black uppercase tracking-[0.4em] transition-all rounded-[24px] hover:bg-red-500/5 group"><LogOut className="w-6 h-6 group-hover:scale-110 transition-all" /> SIGN_OUT</button></div>
            </aside>
            {isMobileMenuOpen && <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}
          </>
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
