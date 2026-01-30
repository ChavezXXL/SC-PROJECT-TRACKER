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
const formatDuration = (mins: number | undefined) => {
  if (mins === undefined || mins === null) return 'Running...';
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

// --- PRINT STYLES ---
const PrintStyles = () => (
  <style>{`
    @media print {
      body { margin: 0; padding: 0; background: white !important; color: black !important; }
      body * { visibility: hidden !important; }
      #printable-content, #printable-content * { visibility: visible !important; }
      #printable-content {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 40px !important;
        background: white !important;
        z-index: 9999 !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .no-print { display: none !important; }
      @page { size: portrait; margin: 0; }
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
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return <span className="tabular-nums font-mono">{h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}</span>;
};

// --- COMPONENT: ACTIVE JOB PANEL ---
const ActiveJobPanel = ({ job, log, onStop }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void> }) => {
  const [isStopping, setIsStopping] = useState(false);
  const handleStopClick = async () => {
    if (isStopping) return;
    setIsStopping(true);
    await onStop(log.id);
  };

  return (
    <div className="bg-zinc-900 border border-blue-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-50 animate-pulse"></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        <div className="flex flex-col justify-center">
           <div className="flex items-center gap-2 mb-4"><span className="animate-pulse w-3 h-3 rounded-full bg-red-500"/><span className="text-red-400 font-bold uppercase tracking-widest text-xs">Job In Progress</span></div>
           <h2 className="text-4xl md:text-5xl font-black text-white mb-2">{job ? job.jobIdsDisplay : 'Unknown Job'}</h2>
           <div className="text-xl text-blue-400 font-medium mb-8 flex items-center gap-2"><span className="px-3 py-1 bg-blue-500/10 rounded-lg border border-blue-500/20">{log.operation}</span></div>
           <div className="bg-black/40 rounded-2xl p-6 border border-white/10 mb-6 w-full max-w-sm flex items-center justify-between">
              <div><p className="text-xs text-zinc-500 uppercase mb-1">Elapsed Time</p><div className="text-white text-4xl font-bold"><LiveTimer startTime={log.startTime} /></div></div>
              <Clock className="w-8 h-8 text-zinc-600" />
           </div>
           <button onClick={handleStopClick} disabled={isStopping} className="w-full max-w-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-8 py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all">
              {isStopping ? 'Stopping...' : <><StopCircle className="w-6 h-6" /> Stop Timer</>}
           </button>
        </div>
        <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col h-full opacity-90">
           <h3 className="text-zinc-400 font-bold uppercase text-sm mb-6 flex items-center gap-2"><Info className="w-4 h-4" /> Job Details</h3>
           {job ? (
             <>
               <div className="grid grid-cols-2 gap-y-6 gap-x-4 mb-6">
                  <div><label className="text-xs text-zinc-500 uppercase font-bold">Part</label><div className="text-lg font-bold text-white break-words">{job.partNumber}</div></div>
                  <div><label className="text-xs text-zinc-500 uppercase font-bold">PO</label><div className="text-lg font-bold text-white break-words">{job.poNumber}</div></div>
                  <div><label className="text-xs text-zinc-500 uppercase font-bold">Qty</label><div className="text-lg font-bold text-white">{job.quantity} units</div></div>
                  <div><label className="text-xs text-zinc-500 uppercase font-bold">Due Date</label><div className="text-lg font-bold text-white">{job.dueDate || 'N/A'}</div></div>
               </div>
               <div className="mt-auto pt-6 border-t border-white/10"><label className="text-xs text-zinc-500 uppercase font-bold mb-2 block">Notes</label><div className="text-zinc-300 text-sm italic">{job.info || "No notes."}</div></div>
             </>
           ) : <p className="text-zinc-500">Details not found.</p>}
        </div>
      </div>
    </div>
  );
};

// --- PRINTABLE JOB TRAVELER ---
const PrintableJobSheet = ({ job, onClose }: { job: Job | null, onClose: () => void }) => {
  if (!job) return null;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(window.location.href.split('?')[0] + '?jobId=' + job.id)}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white text-black w-full max-w-[1000px] rounded-2xl shadow-2xl relative overflow-hidden flex flex-col max-h-[95vh]">
         {/* Toolbar (Hidden when printing) */}
         <div className="bg-zinc-900 text-white p-5 flex justify-between items-center no-print shrink-0 border-b border-zinc-700">
             <div>
               <h3 className="font-bold flex items-center gap-2 text-xl"><Printer className="w-6 h-6 text-blue-500"/> Production Traveler</h3>
               <p className="text-xs text-zinc-400 mt-1 uppercase tracking-widest font-semibold">Print and attach to work bin</p>
             </div>
             <div className="flex gap-4">
                 <button onClick={onClose} className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all">
                    <X className="w-4 h-4" /> Cancel
                 </button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-xl shadow-blue-900/40 transition-all active:scale-95">
                    <Printer className="w-5 h-5"/> Print Now
                 </button>
             </div>
         </div>

         {/* The Printable Page Area */}
         <div id="printable-content" className="flex-1 p-16 bg-white flex flex-col text-black min-h-[11in]">
            {/* Header Section */}
            <div className="flex justify-between items-end border-b-[10px] border-black pb-8 mb-12">
              <div>
                 <h1 className="text-7xl font-black tracking-tighter uppercase leading-none">SC DEBURRING</h1>
                 <p className="text-lg font-black uppercase tracking-[0.5em] text-gray-400 mt-3">Production Traveler</p>
              </div>
              <div className="text-right">
                 <h2 className="text-5xl font-black">{new Date().toLocaleDateString()}</h2>
                 <p className="text-xs font-black uppercase text-gray-400 mt-2 tracking-widest">Date Printed</p>
              </div>
            </div>

            {/* Main Data Container - Filling the Page */}
            <div className="grid grid-cols-5 gap-0 border-[10px] border-black flex-1 overflow-hidden min-h-[600px]">
               {/* Left Data Column (3/5) */}
               <div className="col-span-3 border-r-[10px] border-black p-12 flex flex-col bg-white">
                   <div className="border-b-[6px] border-gray-100 pb-12 mb-12">
                      <label className="block text-sm uppercase font-black text-gray-400 mb-3 tracking-[0.3em]">PO NUMBER</label>
                      <div className="text-[10rem] font-black leading-none break-all">{job.poNumber || "N/A"}</div>
                   </div>

                   <div className="grid grid-cols-2 gap-y-16 gap-x-12">
                      <div>
                         <label className="block text-sm uppercase font-black text-gray-400 mb-2 tracking-[0.2em]">PART NUMBER</label>
                         <div className="text-5xl font-bold break-words leading-tight uppercase">{job.partNumber}</div>
                      </div>
                      <div>
                         <label className="block text-sm uppercase font-black text-gray-400 mb-2 tracking-[0.2em]">QUANTITY</label>
                         <div className="text-7xl font-black">{job.quantity} <span className="text-2xl font-black text-gray-300">UNITS</span></div>
                      </div>
                      <div>
                         <label className="block text-sm uppercase font-black text-gray-400 mb-2 tracking-[0.2em]">DATE RECEIVED</label>
                         <div className="text-4xl font-bold">{job.dateReceived || '-'}</div>
                      </div>
                      <div>
                         <label className="block text-sm uppercase font-black text-gray-400 mb-2 tracking-[0.2em]">DUE DATE</label>
                         <div className="text-5xl font-black text-red-600 underline decoration-[10px] underline-offset-[12px]">{job.dueDate || 'URGENT'}</div>
                      </div>
                   </div>

                   <div className="mt-auto pt-12">
                     <label className="block text-sm uppercase font-black text-gray-400 mb-4 tracking-[0.2em]">JOB NOTES & INSTRUCTIONS</label>
                     <div className="text-4xl font-semibold leading-snug italic border-l-[16px] border-black pl-10 bg-gray-50 py-10 min-h-[250px] flex items-center">
                       {job.info || "No specialized instructions provided for this run."}
                     </div>
                   </div>
               </div>
               
               {/* Right QR Column (2/5) */}
               <div className="col-span-2 flex flex-col items-center justify-center p-12 bg-gray-50 h-full relative">
                  <div className="w-full flex-1 flex items-center justify-center">
                    <img 
                      src={qrUrl} 
                      alt="QR Code" 
                      className="w-full h-auto object-contain mix-blend-multiply" 
                      crossOrigin="anonymous"
                    />
                  </div>
                  <div className="text-center mt-12 w-full">
                    <p className="font-mono text-2xl text-gray-400 break-all mb-4 font-black opacity-40">{job.id}</p>
                    <div className="h-4 w-full bg-black mb-6"/>
                    <p className="font-black uppercase tracking-[0.3em] text-6xl">SCAN JOB ID</p>
                  </div>
                  {/* Decorative Elements */}
                  <div className="absolute top-8 right-8 grid grid-cols-2 gap-2 opacity-10">
                    {[1,2,3,4].map(n => <div key={n} className="w-4 h-4 bg-black rounded-full" />)}
                  </div>
               </div>
            </div>
            
            <div className="mt-12 text-center no-print pb-4">
               <p className="text-zinc-500 text-base font-bold italic">PRO TIP: Set Print Scaling to "Fit to Page" for maximum visibility.</p>
            </div>
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
      <div className="w-full max-w-sm bg-zinc-900/50 backdrop-blur-xl border border-white/5 p-8 rounded-3xl shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-center text-white tracking-tight mb-1">SC DEBURRING</h1>
        <p className="text-center text-zinc-500 text-sm mb-6">Access Portal</p>
        
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Username" autoFocus />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="PIN" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-900/20 mt-2 disabled:opacity-50">
            {loading ? 'Verifying...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

// --- CONFIRMATION MODAL ---
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in confirm-modal">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><AlertTriangle className="text-red-500" /> {title}</h3>
        <p className="text-zinc-400 text-sm mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="text-zinc-400 hover:text-white text-sm">Cancel</button>
          <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-red-900/20">Confirm</button>
        </div>
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

   const myActiveLog = activeLogs.find(l => l.userId === user.id);
   const myActiveJob = myActiveLog ? jobs.find(j => j.id === myActiveLog.jobId) : null;

   return (
      <div className="space-y-6 animate-fade-in">
         {myActiveLog && <ActiveJobPanel job={myActiveJob || null} log={myActiveLog} onStop={(id) => DB.stopTimeLog(id)} />}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center relative overflow-hidden"><div className="relative z-10"><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Live Activity</p><h3 className="text-3xl font-black text-white">{liveJobsCount}</h3><p className="text-xs text-blue-400 mt-1">Jobs running now</p></div><Activity className={`w-10 h-10 text-blue-500 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-20'}`} /></div>
            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center"><div><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">In Progress</p><h3 className="text-3xl font-black text-white">{wipJobsCount}</h3><p className="text-xs text-zinc-500 mt-1">Total open jobs</p></div><Briefcase className="text-zinc-600 w-10 h-10" /></div>
            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center"><div><p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Floor Staff</p><h3 className="text-3xl font-black text-white">{activeWorkersCount}</h3><p className="text-xs text-zinc-500 mt-1">Clocked in</p></div><Users className="text-emerald-500 w-10 h-10" /></div>
         </div>
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col h-full"><div className="p-6 border-b border-white/5"><h3 className="font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500"/> Live Operations</h3></div><div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">{activeLogs.length === 0 && <div className="p-8 text-center text-zinc-500">Floor is quiet. No active timers.</div>}{activeLogs.map(l => (<div key={l.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors"><div className="flex items-center gap-4"><div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 border border-white/5">{l.userName.charAt(0)}</div><div><p className="font-bold text-white">{l.userName}</p><p className="text-xs text-zinc-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {l.operation}</p></div></div><div className="flex items-center gap-4"><div className="text-white text-xl font-bold font-mono"><LiveTimer startTime={l.startTime} /></div><button onClick={() => confirmAction({ title: "Force Stop", message: "Stop this timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white transition-colors"><Power className="w-4 h-4" /></button></div></div>))}</div></div>
             <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col h-full"><div className="p-6 border-b border-white/5 flex justify-between items-center"><h3 className="font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-blue-500"/> Recent Activity</h3><button onClick={() => setView('admin-logs')} className="text-xs text-blue-400 hover:text-white transition-colors">View All</button></div><div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">{logs.length === 0 && <div className="p-8 text-center text-zinc-500">No recent history.</div>}{logs.map(l => (<div key={l.id} className="p-4 flex items-start gap-3 hover:bg-white/5 transition-colors"><div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-500' : 'bg-emerald-500'}`}></div><div className="flex-1"><p className="text-sm text-white"><span className="font-bold">{l.userName}</span> {l.endTime ? 'completed' : 'started'} <span className="text-zinc-300">{l.operation}</span></p><p className="text-xs text-zinc-500 mt-0.5">Job: {l.jobId} • {new Date(l.startTime).toLocaleTimeString()}</p></div>{l.durationMinutes && (<div className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-1 rounded">{formatDuration(l.durationMinutes)}</div>)}</div>))}</div></div>
         </div>
      </div>
   );
};

// --- JOBS VIEW ---
const JobsView = ({ user, addToast, setPrintable, confirm }: any) => {
   const [jobs, setJobs] = useState<Job[]>([]);
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [aiLoading, setAiLoading] = useState(false);
   const [search, setSearch] = useState('');
   const [startJobModal, setStartJobModal] = useState<Job | null>(null);

   useEffect(() => DB.subscribeJobs(setJobs), []);

   const activeJobs = useMemo(() => {
     const term = search.toLowerCase();
     return jobs.filter(j => j.status !== 'completed' && JSON.stringify(j).toLowerCase().includes(term));
   }, [jobs, search]);

   const handleSave = async () => {
      const job = { ...editingJob, id: editingJob.id || Date.now().toString(), createdAt: editingJob.createdAt || Date.now(), status: editingJob.status || 'pending', dateReceived: editingJob.dateReceived || new Date().toISOString().split('T')[0] } as Job;
      await DB.saveJob(job);
      setShowModal(false);
      addToast('success', 'Job Saved');
   };

   return (
      <div className="space-y-6">
         <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold flex items-center gap-2"><Briefcase className="w-6 h-6 text-blue-500"/> Job Management</h2>
            <div className="flex gap-2 items-center">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="pl-9 pr-4 py-2 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white w-64 outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-2"><Plus className="w-4 h-4"/> New Job</button>
            </div>
         </div>
         
         <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-widest"><Activity className="w-4 h-4"/> Active Production</div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/60 text-zinc-500"><tr><th className="p-4">PO</th><th className="p-4">Job</th><th className="p-4">Part</th><th className="p-4">Qty</th><th className="p-4">Status</th><th className="p-4">Due</th><th className="p-4 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/5">
                    {activeJobs.map(job => (
                    <tr key={job.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold text-white">{job.poNumber || '-'}</td>
                        <td className="p-4 text-zinc-200">{job.jobIdsDisplay}</td>
                        <td className="p-4 text-zinc-400">{job.partNumber}</td>
                        <td className="p-4 font-mono text-white">{job.quantity}</td>
                        <td className="p-4"><span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${job.status === 'in-progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>{job.status}</span></td>
                        <td className="p-4 text-zinc-400 font-mono">{job.dueDate || '—'}</td>
                        <td className="p-4 text-right flex justify-end gap-2">
                            <button onClick={() => setStartJobModal(job)} className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"><Play className="w-4 h-4" /></button>
                            <button onClick={() => confirm({ title: "Complete Job", message: "Mark as done?", onConfirm: () => DB.completeJob(job.id) })} className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"><CheckCircle className="w-4 h-4" /></button>
                            <button onClick={() => setPrintable(job)} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"><Printer className="w-4 h-4" /></button>
                            <button onClick={() => { setEditingJob(job); setShowModal(true); }} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => confirm({ title: "Delete", message: "Delete job?", onConfirm: () => DB.deleteJob(job.id) })} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"><Trash2 className="w-4 h-4" /></button>
                        </td>
                    </tr>))}
                </tbody>
                </table>
            </div>
         </div>

         {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50"><h3 className="font-bold text-white">Job Details</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button></div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl">
                <textarea placeholder="Paste job info here..." className="w-full bg-black/20 border border-blue-500/20 rounded-lg p-2 text-xs text-blue-200 outline-none" rows={2} onBlur={async (e) => { if(!e.target.value) return; setAiLoading(true); try { const data = await parseJobDetails(e.target.value); setEditingJob(p => ({ ...p, ...data })); addToast('success', 'AI Parsed'); } finally { setAiLoading(false); } }} />
                {aiLoading && <p className="text-xs text-blue-400 mt-1 animate-pulse">Extracting details...</p>}
              </div>
              <div><label className="text-xs text-blue-400 font-bold uppercase mb-1 block">PO Number</label><input className="w-full bg-black/40 border-2 border-blue-500/50 rounded-xl p-3 text-white text-lg font-bold outline-none focus:ring-2 focus:ring-blue-500" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 mb-1 block">Job ID(s)</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">Part Number</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 mb-1 block">Quantity</label><input type="number" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                <div><label className="text-xs text-zinc-500 mb-1 block">Due Date</label><input type="date" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
              </div>
              <div><label className="text-xs text-zinc-500 mb-1 block">Notes</label><textarea className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" rows={3} value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2"><button onClick={() => setShowModal(false)} className="px-4 py-2 text-zinc-400">Cancel</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-medium">Save Job</button></div>
          </div>
        </div>
      )}
      {startJobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-6">
             <h3 className="text-lg font-bold text-white mb-2">Start Operation</h3>
             <div className="grid grid-cols-2 gap-2 mt-4">
               {DB.getSettings().customOperations.map(op => (
                 <button key={op} onClick={async () => { await DB.startTimeLog(startJobModal.id, user.id, user.name, op); addToast('success', 'Started'); setStartJobModal(null); }} className="bg-zinc-800 hover:bg-blue-600 text-white py-3 rounded-xl text-sm font-medium transition-colors">{op}</button>
               ))}
             </div>
             <button onClick={() => setStartJobModal(null)} className="w-full mt-4 text-zinc-500 text-sm">Cancel</button>
        </div></div>
      )}
      </div>
   );
};

// --- LOGS VIEW ---
const LogsView = ({ addToast }: { addToast: any }) => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
   useEffect(() => DB.subscribeLogs(setLogs), []);
   return (
      <div className="space-y-6">
         <h2 className="text-2xl font-bold flex items-center gap-2"><Calendar className="w-6 h-6 text-blue-500" /> Work Logs</h2>
         <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/60 text-zinc-500"><tr><th className="p-4">Date</th><th className="p-4">Time</th><th className="p-4">Employee</th><th className="p-4">Operation</th><th className="p-4 text-right">Duration</th></tr></thead>
                <tbody className="divide-y divide-white/5">{logs.map(l => (
                    <tr key={l.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 text-zinc-300">{new Date(l.startTime).toLocaleDateString()}</td>
                        <td className="p-4 font-mono text-zinc-300">{new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} {l.endTime ? '— ' + new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : <span className="text-emerald-400 font-bold ml-2">ACTIVE</span>}</td>
                        <td className="p-4 text-white font-medium">{l.userName}</td>
                        <td className="p-4"><span className="px-3 py-1 bg-zinc-800 border border-white/5 rounded-lg text-xs font-bold">{l.operation}</span></td>
                        <td className="p-4 text-right font-mono text-zinc-300">{formatDuration(l.durationMinutes)}</td>
                    </tr>))}
                </tbody>
            </table>
         </div>
      </div>
   );
};

// --- TEAM VIEW ---
const AdminEmployees = ({ addToast, confirm }: { addToast: any, confirm: any }) => {
   const [users, setUsers] = useState<User[]>([]);
   const [editingUser, setEditingUser] = useState<Partial<User>>({});
   const [showModal, setShowModal] = useState(false);
   useEffect(() => DB.subscribeUsers(setUsers), []);
   const handleSave = async () => { if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'Missing fields'); await DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true }); setShowModal(false); addToast('success', 'User Saved'); };
   return (<div className="space-y-6"><div className="flex justify-between items-center"><h2 className="text-2xl font-bold text-white">Team</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2"><Plus className="w-4 h-4" /> Add Member</button></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{users.map(u => (<div key={u.id} className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400"><UserIcon className="w-5 h-5" /></div><div><p className="font-bold text-white">{u.name}</p><p className="text-xs text-zinc-500">@{u.username} • {u.role}</p></div></div><div className="flex gap-2"><button onClick={() => confirm({ title: "Remove User", message: "Delete this user?", onConfirm: () => DB.deleteUser(u.id) })} className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button><button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button></div></div>))}</div>{showModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"><div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50"><h3 className="font-bold text-white">User Details</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button></div><div className="p-6 space-y-4"><div><label className="text-xs text-zinc-500 ml-1">Full Name</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div><div><label className="text-xs text-zinc-500 ml-1">Username</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div><div><label className="text-xs text-zinc-500 ml-1">PIN</label><input type="text" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div><div><label className="text-xs text-zinc-500 ml-1">Role</label><select className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div></div><div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2"><button onClick={() => setShowModal(false)} className="px-4 py-2 text-zinc-400">Cancel</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-medium">Save</button></div></div></div>)}</div>);
};

// --- SETTINGS VIEW ---
const SettingsView = ({ addToast }: { addToast: any }) => {
   const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
   const [newOp, setNewOp] = useState('');
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Updated'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   return (<div className="max-w-xl space-y-6"><h2 className="text-2xl font-bold text-white">System Settings</h2><div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6"><div><label className="text-xs text-zinc-500 block mb-1">Auto-Clock Out Time</label><input type="time" value={settings.autoClockOutTime} onChange={e => setSettings({...settings, autoClockOutTime: e.target.value})} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" /></div></div><div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6"><h3 className="font-bold text-white">Production Operations</h3><div className="space-y-4"><div className="flex gap-2"><input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="New Op..." className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" /><button onClick={handleAddOp} className="bg-blue-600 px-4 rounded-lg text-white"><Plus className="w-4 h-4" /></button></div><div className="flex flex-wrap gap-2">{settings.customOperations?.map(op => (<div key={op} className="bg-zinc-800 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2"><span>{op}</span><button onClick={() => setSettings({...settings, customOperations: settings.customOperations.filter(o => o !== op)})} className="text-zinc-500 hover:text-red-500"><X className="w-3 h-3" /></button></div>))}</div></div></div><div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2"><Save className="w-5 h-5" /> Save Changes</button></div></div>);
};

// --- EMPLOYEE DASHBOARD ---
const EmployeeDashboard = ({ user, addToast, onLogout }: { user: User, addToast: any, onLogout: () => void }) => {
  const [tab, setTab] = useState<'jobs' | 'scan'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const unsubLogs = DB.subscribeLogs((all) => {
       const active = all.find(l => l.userId === user.id && !l.endTime);
       setActiveLog(active || null);
       if (active) DB.getJobById(active.jobId).then(j => setActiveJob(j));
    });
    const unsubJobs = DB.subscribeJobs(setJobs);
    return () => { unsubLogs(); unsubJobs(); };
  }, [user.id]);
  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {activeLog && <ActiveJobPanel job={activeJob} log={activeLog} onStop={(id) => DB.stopTimeLog(id)} />}
      <div className="flex justify-between items-center bg-zinc-900/50 p-2 rounded-2xl border border-white/5 no-print">
         <div className="flex gap-2"><button onClick={() => setTab('jobs')} className={`px-4 py-2 rounded-xl text-sm font-medium ${tab === 'jobs' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}>Jobs</button></div>
         <div className="flex items-center gap-2"><button onClick={() => setTab('scan')} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${tab === 'scan' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-blue-400'}`}><ScanLine className="w-4 h-4" /> Scan</button><button onClick={onLogout} className="bg-red-500/10 text-red-500 px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2"><LogOut className="w-4 h-4" /> Exit</button></div>
      </div>
      {tab === 'scan' ? (
         <div className="flex-1 flex items-center justify-center animate-fade-in"><div className="bg-zinc-900 p-8 rounded-3xl border border-white/10 text-center max-w-sm w-full"><QrCode className="w-16 h-16 mx-auto text-blue-500 mb-4" /><h2 className="text-2xl font-bold text-white mb-4">Scan Job QR</h2><input autoFocus onKeyDown={(e:any) => { if(e.key === 'Enter') { setSearch(e.target.value); setTab('jobs'); addToast('success', 'Found'); } }} className="bg-black/50 border border-blue-500 rounded-xl px-4 py-3 text-white text-center w-full text-lg" placeholder="Scan..." /></div></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.filter(j => j.status !== 'completed').map(j => (
                <div key={j.id} className="bg-zinc-900/50 p-6 rounded-2xl border border-white/5">
                    <h3 className="font-bold text-white text-lg">{j.jobIdsDisplay}</h3>
                    <p className="text-xs text-zinc-500 mt-1 uppercase font-bold tracking-widest">{j.partNumber}</p>
                    <div className="grid grid-cols-2 gap-2 mt-4">
                        {DB.getSettings().customOperations.map(op => (
                            <button key={op} onClick={() => DB.startTimeLog(j.id, user.id, user.name, op)} className="bg-zinc-800 hover:bg-blue-600 text-white py-2 rounded-xl text-xs font-bold transition-all">{op}</button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
      )}
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

  useEffect(() => { if(user) localStorage.setItem('nexus_user', JSON.stringify(user)); else localStorage.removeItem('nexus_user'); if(!user) setView('login'); else if(user.role === 'admin' && view === 'login') setView('admin-dashboard'); else if(user.role === 'employee' && view === 'login') setView('employee-scan'); }, [user]);
  const addToast = (t: any, m: any) => setToasts(p => [...p, {id: Date.now().toString(), type: t, message: m}]);

  if (!user || view === 'login') return <><PrintStyles /><LoginView onLogin={setUser} addToast={addToast} /><div className="fixed bottom-4 right-4 z-50 pointer-events-none"><div className="pointer-events-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div></>;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans">
       <PrintStyles /><PrintableJobSheet job={printable} onClose={() => setPrintable(null)} /><ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
       {user.role === 'admin' && (
          <aside className="w-64 border-r border-white/5 bg-zinc-950 flex flex-col fixed h-full z-20">
             <div className="p-6 font-bold text-white flex gap-2 items-center"><Sparkles className="text-blue-500"/> NEXUS</div>
             <nav className="px-4 space-y-1">
                {[{id: 'admin-dashboard', l: 'Overview', i: LayoutDashboard}, {id: 'admin-jobs', l: 'Jobs', i: Briefcase}, {id: 'admin-logs', l: 'Logs', i: Calendar}, {id: 'admin-team', l: 'Team', i: Users}, {id: 'admin-settings', l: 'Settings', i: Settings}].map(x => <button key={x.id} onClick={() => setView(x.id as any)} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold ${view === x.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}><x.i className="w-4 h-4" /> {x.l}</button>)}
             </nav>
             <button onClick={() => setUser(null)} className="mt-auto m-6 flex items-center gap-3 text-zinc-500 hover:text-white text-sm font-bold"><LogOut className="w-4 h-4" /> Sign Out</button>
          </aside>
       )}
       <main className={`flex-1 p-8 ${user.role === 'admin' ? 'ml-64' : ''}`}>
          {view === 'admin-dashboard' && <AdminDashboard user={user} confirmAction={setConfirm} setView={setView} />}
          {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} />}
          {view === 'admin-logs' && <LogsView addToast={addToast} />}
          {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-settings' && <SettingsView addToast={addToast} />}
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} />}
       </main>
       <div className="fixed bottom-6 right-6 z-50 pointer-events-none"><div className="pointer-events-auto flex flex-col items-end gap-2">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div>
    </div>
  );
}
