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

// --- PRINT STYLES (Optimized to fill page) ---
const PrintStyles = () => (
  <style>{`
    @media print {
      body { margin: 0; padding: 0; background: white !important; }
      body * { visibility: hidden !important; }
      #printable-area, #printable-area * { visibility: visible !important; }
      #printable-area {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: auto !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 10mm !important;
        background: white !important;
        z-index: 9999 !important;
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

// --- PRINTABLE JOB TRAVELER (Optimized Layout) ---
const PrintableJobSheet = ({ job, onClose }: { job: Job | null, onClose: () => void }) => {
  if (!job) return null;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&data=${encodeURIComponent(window.location.href.split('?')[0] + '?jobId=' + job.id)}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white text-black w-full max-w-[950px] rounded-xl shadow-2xl relative overflow-hidden flex flex-col max-h-[95vh]">
         
         {/* Toolbar Area (RESTORED) */}
         <div className="bg-zinc-900 text-white p-4 flex justify-between items-center no-print shrink-0 border-b border-zinc-700">
             <div>
               <h3 className="font-bold flex items-center gap-2 text-lg"><Printer className="w-5 h-5 text-blue-500"/> Print Preview</h3>
               <p className="text-xs text-zinc-400">Review details before sending to printer.</p>
             </div>
             <div className="flex gap-3">
                 <button onClick={onClose} className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all">
                    <X className="w-4 h-4" /> Cancel
                 </button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-900/40 transition-all active:scale-95">
                    <Printer className="w-5 h-5"/> Print Traveler
                 </button>
             </div>
         </div>

         {/* The Printable Container */}
         <div id="printable-area" className="flex-1 p-12 bg-white overflow-y-auto flex flex-col">
            {/* Header section */}
            <div className="flex justify-between items-end border-b-8 border-black pb-6 mb-10">
              <div>
                 <h1 className="text-7xl font-black tracking-tighter uppercase leading-none">SC DEBURRING</h1>
                 <p className="text-base font-black uppercase tracking-[0.4em] text-gray-500 mt-2">Production Traveler</p>
              </div>
              <div className="text-right">
                 <h2 className="text-4xl font-black">{new Date().toLocaleDateString()}</h2>
                 <p className="text-xs font-black uppercase text-gray-400 mt-1 tracking-widest">Printed On</p>
              </div>
            </div>

            {/* Main content grid - matching the user layout exactly */}
            <div className="grid grid-cols-5 gap-0 border-8 border-black flex-1 overflow-hidden">
               {/* Left Column (Data) */}
               <div className="col-span-3 border-r-8 border-black p-12 space-y-12 flex flex-col h-full bg-white">
                   <div className="border-b-4 border-gray-100 pb-10">
                      <label className="block text-xs uppercase font-black text-gray-400 mb-2 tracking-[0.3em]">PO Number</label>
                      <div className="text-9xl font-black leading-none break-all">{job.poNumber}</div>
                   </div>

                   <div className="grid grid-cols-2 gap-12">
                      <div>
                         <label className="block text-xs uppercase font-black text-gray-400 mb-1 tracking-[0.3em]">Part Number</label>
                         <div className="text-5xl font-bold break-words leading-tight">{job.partNumber}</div>
                      </div>
                      <div>
                         <label className="block text-xs uppercase font-black text-gray-400 mb-1 tracking-[0.3em]">Quantity</label>
                         <div className="text-6xl font-black">{job.quantity} UNITS</div>
                      </div>
                      <div>
                         <label className="block text-xs uppercase font-black text-gray-400 mb-1 tracking-[0.3em]">Date Received</label>
                         <div className="text-3xl font-bold">{job.dateReceived || '-'}</div>
                      </div>
                      <div>
                         <label className="block text-xs uppercase font-black text-gray-400 mb-1 tracking-[0.3em]">Due Date</label>
                         <div className="text-4xl font-black text-red-600 underline decoration-8 underline-offset-8">{job.dueDate || '-'}</div>
                      </div>
                   </div>

                   <div className="flex-1 flex flex-col pt-8">
                     <label className="block text-xs uppercase font-black text-gray-400 mb-4 tracking-[0.3em]">Job Notes / Instructions</label>
                     <div className="flex-1 text-3xl font-medium leading-relaxed italic border-l-[12px] border-black pl-10 bg-gray-50 py-8 min-h-[200px]">
                       {job.info || "No notes provided for this job."}
                     </div>
                   </div>
               </div>
               
               {/* Right Column (QR & Visual Scan Area) */}
               <div className="col-span-2 flex flex-col items-center justify-center p-12 bg-gray-50 h-full relative">
                  <div className="w-full flex-1 flex items-center justify-center">
                    <img 
                      src={qrUrl} 
                      alt="QR Code" 
                      className="w-full h-auto object-contain mix-blend-multiply" 
                      crossOrigin="anonymous" 
                      style={{ maxWidth: '100%', maxHeight: '550px' }}
                    />
                  </div>
                  <div className="text-center mt-12 w-full">
                    <p className="font-mono text-xl text-gray-400 break-all mb-4 opacity-70 font-bold">{job.id}</p>
                    <div className="h-4 w-full bg-black mb-6"/>
                    <p className="font-black uppercase tracking-[0.3em] text-5xl">SCAN JOB ID</p>
                  </div>
               </div>
            </div>
            
            <div className="mt-10 text-center no-print pb-4">
               <p className="text-zinc-500 text-sm italic font-medium">Tip: Use browser print settings to scale to "100%" or "Fit to page" for full coverage.</p>
            </div>
         </div>
      </div>
    </div>
  );
};

// --- COMPONENT: MONTH SELECTOR ---
const MonthSelector = ({ value, onChange, rangeType }: { value: string, onChange: (v: string) => void, rangeType: string }) => {
  if (rangeType !== 'year') return null;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ml-2 animate-fade-in">
       <option value="all">Full Year</option>
       {months.map((m, i) => <option key={m} value={i.toString()}>{m}</option>)}
    </select>
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
   const [historyRange, setHistoryRange] = useState<'week'|'month'|'year'|'all'>('week');
   const [selectedMonth, setSelectedMonth] = useState('all');

   useEffect(() => DB.subscribeJobs(setJobs), []);

   const activeJobs = useMemo(() => {
     const term = search.toLowerCase();
     return jobs.filter(j => j.status !== 'completed' && JSON.stringify(j).toLowerCase().includes(term));
   }, [jobs, search]);

   const completedInRange = useMemo(() => {
     const now = Date.now();
     const day = 86400000;
     return jobs.filter(j => j.status === 'completed').filter(j => {
       const ts = j.completedAt || j.createdAt;
       if (historyRange === 'all') return true;
       if (historyRange === 'week') return ts >= now - 7 * day;
       if (historyRange === 'month') return ts >= now - 30 * day;
       if (historyRange === 'year') {
         const d = new Date(ts);
         if (selectedMonth !== 'all') return d.getFullYear() === new Date().getFullYear() && d.getMonth() === parseInt(selectedMonth);
         return d.getFullYear() === new Date().getFullYear();
       }
       return true;
     });
   }, [jobs, historyRange, selectedMonth]);

   const unitsProcessed = completedInRange.reduce((s, j) => s + (Number(j.quantity) || 0), 0);

   const handleComplete = (id: string) => confirm({ title: "Complete Job", message: "Mark as done?", onConfirm: () => DB.completeJob(id) });
   const handleReopen = (id: string) => confirm({ title: "Reopen Job", message: "Move back to active?", onConfirm: () => DB.reopenJob(id) });
   const handleDelete = (id: string) => confirm({ title: "Delete", message: "Delete job?", onConfirm: () => DB.deleteJob(id) });

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
                            <button onClick={() => handleComplete(job.id)} className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"><CheckCircle className="w-4 h-4" /></button>
                            <button onClick={() => setPrintable(job)} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"><Printer className="w-4 h-4" /></button>
                            <button onClick={() => { setEditingJob(job); setShowModal(true); }} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(job.id)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"><Trash2 className="w-4 h-4" /></button>
                        </td>
                    </tr>))}
                    {activeJobs.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-zinc-500">No active production.</td></tr>}
                </tbody>
                </table>
            </div>
         </div>

         <section className="space-y-4 mt-10">
            <div className="flex items-end justify-between">
                <div><h3 className="text-xl font-bold flex items-center gap-2"><History className="w-5 h-5 text-zinc-400" /> Job History</h3><p className="text-sm text-zinc-500">Completed runs</p></div>
                <div className="flex items-center gap-2">
                    <MonthSelector value={selectedMonth} onChange={setSelectedMonth} rangeType={historyRange} />
                    <div className="inline-flex rounded-xl bg-zinc-900/60 border border-white/5 p-1">
                        {['week', 'month', 'year', 'all'].map(k => (
                        <button key={k} onClick={() => { setHistoryRange(k as any); setSelectedMonth('all'); }} className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${historyRange === k ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>{k.toUpperCase()}</button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
                   <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Jobs Completed</div>
                   <div className="text-3xl font-black text-white mt-2">{completedInRange.length}</div>
                </div>
                <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
                   <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Units Processed</div>
                   <div className="text-3xl font-black text-white mt-2">{unitsProcessed}</div>
                </div>
            </div>
            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/60 text-zinc-500"><tr><th className="p-4">PO</th><th className="p-4">Job</th><th className="p-4">Part</th><th className="p-4">Qty</th><th className="p-4">Finished</th><th className="p-4 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/5">
                    {completedInRange.map(j => (
                    <tr key={j.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold text-zinc-300">{j.poNumber}</td>
                        <td className="p-4 text-zinc-400">{j.jobIdsDisplay}</td>
                        <td className="p-4 text-zinc-500">{j.partNumber}</td>
                        <td className="p-4 font-mono text-white">{j.quantity}</td>
                        <td className="p-4 text-zinc-500 font-mono">{new Date(j.completedAt || j.createdAt).toLocaleDateString()}</td>
                        <td className="p-4 text-right flex justify-end gap-2">
                            <button onClick={() => handleReopen(j.id)} className="p-2 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20"><RotateCcw className="w-4 h-4" /></button>
                            <button onClick={() => setPrintable(j)} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"><Printer className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(j.id)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"><Trash2 className="w-4 h-4" /></button>
                        </td>
                    </tr>))}
                </tbody>
                </table>
            </div>
         </section>

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
              <div><label className="text-xs text-zinc-500 mb-1 block">Date Received</label><input type="date" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.dateReceived || ''} onChange={e => setEditingJob({...editingJob, dateReceived: e.target.value})} /></div>
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
   const [jobs, setJobs] = useState<Job[]>([]);
   const [users, setUsers] = useState<User[]>([]);
   const [range, setRange] = useState<'week'|'month'|'year'|'all'>('week');
   const [selectedMonth, setSelectedMonth] = useState('all');
   const [filter, setFilter] = useState('');
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);

   useEffect(() => {
     const u1 = DB.subscribeLogs(setLogs);
     const u2 = DB.subscribeJobs(setJobs);
     const u3 = DB.subscribeUsers(setUsers);
     return () => { u1(); u2(); u3(); };
   }, []);

   const filteredLogs = useMemo(() => {
     const term = filter.toLowerCase();
     const now = Date.now();
     const day = 86400000;
     return logs.filter(l => {
       if (range === 'week') if (l.startTime < now - 7 * day) return false;
       if (range === 'month') if (l.startTime < now - 30 * day) return false;
       if (range === 'year') {
         const d = new Date(l.startTime);
         if (d.getFullYear() !== new Date().getFullYear()) return false;
         if (selectedMonth !== 'all' && d.getMonth() !== parseInt(selectedMonth)) return false;
       }
       const job = jobs.find(j => j.id === l.jobId);
       const str = `${l.userName} ${l.operation} ${job?.poNumber || ''} ${job?.jobIdsDisplay || ''}`.toLowerCase();
       return str.includes(term);
     }).sort((a,b) => b.startTime - a.startTime);
   }, [logs, range, filter, jobs, selectedMonth]);

   const logsByJob = useMemo(() => {
     return filteredLogs.reduce((acc, log) => {
       (acc[log.jobId] ||= []).push(log);
       return acc;
     }, {} as Record<string, TimeLog[]>);
   }, [filteredLogs]);

   const totalHours = Math.round((filteredLogs.reduce((s, l) => s + (l.durationMinutes || 0), 0) / 60) * 100) / 100;
   const uniqueJobsCount = Object.keys(logsByJob).length;

   return (
      <div className="space-y-6">
         <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold flex items-center gap-2"><Calendar className="w-6 h-6 text-blue-500" /> Work Logs</h2>
            <div className="flex items-center gap-2">
                <MonthSelector value={selectedMonth} onChange={setSelectedMonth} rangeType={range} />
                <div className="inline-flex rounded-xl bg-zinc-900/60 border border-white/5 p-1">
                {['week', 'month', 'year', 'all'].map(k => (
                    <button key={k} onClick={() => { setRange(k as any); setSelectedMonth('all'); }} className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${range === k ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>{k.toUpperCase()}</button>
                ))}
                </div>
            </div>
         </div>

         <div className="relative">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-500" />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by Job, PO, Part, or Employee..." className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" />
         </div>

         <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6"><div className="text-xs text-blue-300 font-bold uppercase">Total Hours</div><div className="text-3xl font-black text-white mt-2">{totalHours} <span className="text-base text-blue-300">hrs</span></div></div>
            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6"><div className="text-xs text-zinc-500 font-bold uppercase">Records</div><div className="text-3xl font-black text-white mt-2">{filteredLogs.length}</div></div>
            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6"><div className="text-xs text-zinc-500 font-bold uppercase">Unique Jobs</div><div className="text-3xl font-black text-white mt-2">{uniqueJobsCount}</div></div>
         </div>

         <div className="space-y-6">
            <div className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2 mt-2"><History className="w-4 h-4" /> COMPLETED HISTORY</div>
            {Object.entries(logsByJob).map(([jobId, entries]) => {
                const job = jobs.find(j => j.id === jobId);
                const totalMins = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
                return (
                    <div key={jobId} className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden shadow-sm">
                        <div className="bg-white/5 px-6 py-4 border-b border-white/5 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400"><Briefcase className="w-5 h-5" /></div>
                                <div><div className="text-lg font-bold text-white">{job?.jobIdsDisplay || jobId}</div><div className="text-xs text-zinc-500 flex gap-2"><span className="bg-zinc-950 px-2 py-1 rounded border border-white/5">PO: {job?.poNumber || '—'}</span><span className="bg-zinc-950 px-2 py-1 rounded border border-white/5">Part: {job?.partNumber || '—'}</span><span className="bg-blue-500/10 text-blue-400 px-2 py-1 rounded border border-blue-500/20">Qty: {job?.quantity || '—'}</span></div></div>
                            </div>
                            <div className="text-right"><div className="text-xs text-zinc-500 font-bold uppercase">Total Time</div><div className="text-white font-black">{formatDuration(totalMins)}</div></div>
                        </div>
                        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-zinc-950/60 text-zinc-500"><tr><th className="p-4">Date</th><th className="p-4">Time Range</th><th className="p-4">Employee</th><th className="p-4">Operation</th><th className="p-4 text-right">Duration</th><th className="p-4"></th></tr></thead>
                            <tbody className="divide-y divide-white/5">{entries.map(l => (
                                <tr key={l.id} className="hover:bg-white/5 transition-colors">
                                    <td className="p-4 text-zinc-300">{new Date(l.startTime).toLocaleDateString()}</td>
                                    <td className="p-4 font-mono text-zinc-300">{new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} <span className="mx-2 text-zinc-600">—</span> {l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : <span className="text-emerald-400 font-bold">ACTIVE</span>}</td>
                                    <td className="p-4 text-white font-medium">{l.userName}</td>
                                    <td className="p-4"><span className="px-3 py-1 bg-zinc-800 border border-white/5 rounded-lg text-xs font-bold">{l.operation}</span></td>
                                    <td className="p-4 text-right font-mono text-zinc-300">{formatDuration(l.durationMinutes)}</td>
                                    <td className="p-4 text-right"><button onClick={() => setEditingLog({...l})} className="p-2 text-zinc-500 hover:text-white"><Edit2 className="w-4 h-4" /></button></td>
                                </tr>))}
                            </tbody></table></div>
                    </div>
                );
            })}
         </div>

         {editingLog && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
                 <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50"><h3 className="font-bold text-white flex items-center gap-2"><Edit2 className="w-4 h-4 text-blue-500" /> Edit Log</h3><button onClick={() => setEditingLog(null)}><X className="w-5 h-5 text-zinc-500" /></button></div>
                 <div className="p-6 space-y-5">
                     <div><label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Employee</label><select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-blue-500" value={editingLog.userId} onChange={e => { const u = users.find(u => u.id === e.target.value); if(u) setEditingLog({...editingLog, userId: u.id, userName: u.name}); }} >{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
                     <div><label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Operation</label><select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-blue-500" value={editingLog.operation} onChange={e => setEditingLog({...editingLog, operation: e.target.value})} >{DB.getSettings().customOperations.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                     <div className="grid grid-cols-2 gap-4">
                         <div><label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Start</label><input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm" value={toDateTimeLocal(editingLog.startTime)} onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})} /></div>
                         <div><label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">End</label><input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm" value={toDateTimeLocal(editingLog.endTime)} onChange={e => setEditingLog({...editingLog, endTime: e.target.value ? new Date(e.target.value).getTime() : null})} /></div>
                     </div>
                 </div>
                 <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-between items-center"><button onClick={async () => { if(window.confirm("Delete record?")) { await DB.deleteTimeLog(editingLog.id); setEditingLog(null); addToast('success', 'Deleted'); } }} className="text-red-500 font-bold flex items-center gap-2"><Trash2 className="w-4 h-4"/> Delete</button><div className="flex gap-2"><button onClick={() => setEditingLog(null)} className="px-4 text-zinc-400">Cancel</button><button onClick={async () => { await DB.updateTimeLog(editingLog); setEditingLog(null); addToast('success', 'Updated'); }} className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold">Save</button></div></div>
             </div></div>
         )}
      </div>
   );
};

// --- COMPONENT: JOB SELECTION CARD ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden transition-all duration-300 ${expanded ? 'ring-2 ring-blue-500/50 bg-zinc-800' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="p-5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-bold text-white">{job.jobIdsDisplay}</h3>
          <span className="bg-zinc-950 text-zinc-400 text-xs px-2 py-1 rounded font-mono">{job.quantity} units</span>
        </div>
        <div className="text-sm text-zinc-500 space-y-1"><p>Part: <span className="text-zinc-300">{job.partNumber}</span></p><p>PO: {job.poNumber}</p></div>
        {!expanded && <div className="mt-4 flex items-center text-blue-400 text-xs font-bold uppercase tracking-wide">Tap to Start <ArrowRight className="w-3 h-3 ml-1" /></div>}
      </div>
      {expanded && (
        <div className="p-4 bg-zinc-950/30 border-t border-white/5 animate-fade-in">
          <p className="text-xs text-zinc-500 uppercase font-bold mb-3">Select Operation:</p>
          <div className="grid grid-cols-2 gap-2">
            {operations.map(op => (<button key={op} onClick={(e) => { e.stopPropagation(); onStart(job.id, op); }} className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-2 px-3 rounded-lg text-sm text-zinc-300 transition-colors">{op}</button>))}
            {operations.length === 0 && <p className="col-span-2 text-xs text-zinc-500 text-center py-2">No operations configured.</p>}
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
       if (myActive) DB.getJobById(myActive.jobId).then(j => setActiveJob(j || null));
       else setActiveJob(null);
    });
    const unsubJobs = DB.subscribeJobs((allJobs) => setJobs(allJobs.filter(j => j.status !== 'completed').reverse()));
    return () => { unsubLogs(); unsubJobs(); };
  }, [user.id]);
  const handleStartJob = async (jobId: string, operation: string) => { try { await DB.startTimeLog(jobId, user.id, user.name, operation); addToast('success', 'Timer Started'); } catch (e) { addToast('error', 'Failed to start timer'); } };
  const handleStopJob = async (logId: string) => { try { await DB.stopTimeLog(logId); addToast('success', 'Job Stopped'); } catch (e) { addToast('error', 'Failed to stop. Please try again.'); } };
  const filteredJobs = jobs.filter(j => JSON.stringify(j).toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {activeLog && <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} />}
      <div className="flex flex-wrap gap-2 justify-between items-center bg-zinc-900/50 backdrop-blur-md p-2 rounded-2xl border border-white/5 no-print">
         <div className="flex gap-2"><button onClick={() => setTab('jobs')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'jobs' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}>Jobs</button><button onClick={() => setTab('history')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4" /> History</button></div>
         <div className="flex items-center gap-2"><button onClick={() => setTab('scan')} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow' : 'bg-zinc-800 text-blue-400 hover:bg-blue-600 hover:text-white'}`}><ScanLine className="w-4 h-4" /> Scan</button><button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"><LogOut className="w-4 h-4" /> Exit</button></div>
      </div>
      {tab === 'scan' ? (
         <div className="flex-1 flex items-center justify-center animate-fade-in py-12"><div className="bg-zinc-900 p-8 rounded-3xl border border-white/10 text-center max-w-sm w-full shadow-2xl"><QrCode className="w-16 h-16 mx-auto text-blue-500 mb-4" /><h2 className="text-2xl font-bold text-white mb-4">Scan Job QR</h2><input autoFocus onKeyDown={(e:any) => { if(e.key === 'Enter') { let val = e.currentTarget.value.trim(); const match = val.match(/[?&]jobId=([^&]+)/); if (match) val = match[1]; setSearch(val); setTab('jobs'); addToast('success', 'Scanned'); } }} className="bg-black/50 border border-blue-500 rounded-xl px-4 py-3 text-white text-center w-full text-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Scan or Type..." /><p className="text-zinc-500 text-xs mt-4">Point scanner at Traveler QR code.</p></div></div>
      ) : tab === 'history' ? (
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden animate-fade-in"><div className="p-4 border-b border-white/5 bg-white/5"><h3 className="font-semibold text-white">Your Recent Activity</h3></div><div className="overflow-y-auto max-h-[60vh]"><table className="w-full text-left text-sm"><thead className="bg-zinc-950/50 text-zinc-500"><tr><th className="p-4">Date</th><th className="p-4">Job</th><th className="p-4">Op</th><th className="p-4">Duration</th></tr></thead><tbody className="divide-y divide-white/5">{myHistory.map(log => (<tr key={log.id}><td className="p-4 text-zinc-400">{new Date(log.startTime).toLocaleDateString()}</td><td className="p-4 text-white font-medium">{log.jobId}</td><td className="p-4 text-zinc-300">{log.operation}</td><td className="p-4 text-zinc-400">{formatDuration(log.durationMinutes)}</td></tr>))}{myHistory.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-zinc-500">No history found.</td></tr>}</tbody></table></div></div>
      ) : (
        <div className="flex-1 flex flex-col animate-fade-in"><div className="relative mb-6"><Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-500" /><input type="text" placeholder="Search by Job #, PO, or Part..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"/></div>{activeLog && <div className="mb-4 p-3 rounded-xl bg-blue-900/20 border border-blue-500/30 text-blue-300 text-sm text-center flex items-center justify-center gap-2"><Info className="w-4 h-4" /> You have a job running. Please stop it before starting a new one.</div>}<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{filteredJobs.map(job => (<JobSelectionCard key={job.id} job={job} onStart={handleStartJob} disabled={!!activeLog} operations={ops} />))}{filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found matching "{search}".</div>}</div></div>
      )}
    </div>
  );
};

// --- COMPONENT: CONFIRMATION MODAL ---
const ConfirmationModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in confirm-modal">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><AlertTriangle className="text-red-500" /> {title}</h3>
        <p className="text-zinc-400 text-sm mb-6">{message}</p>
        <div className="flex justify-end gap-3"><button onClick={onCancel} className="text-zinc-400 hover:text-white text-sm">Cancel</button><button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-red-900/20">Confirm</button></div>
      </div>
    </div>
  );
};

// --- COMPONENT: LOGIN VIEW ---
const LoginView = ({ onLogin, addToast }: { onLogin: (u: User) => void, addToast: any }) => {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const user = await DB.loginUser(username, pin);
      if (user) { onLogin(user); addToast('success', `Welcome, ${user.name}`); }
      else { addToast('error', 'Invalid Credentials'); setPin(''); }
    } catch (e: any) { addToast('error', 'Login Error: ' + (e.message || 'Unknown')); }
    setLoading(false);
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 relative">
      <div className="w-full max-w-sm bg-zinc-900/50 backdrop-blur-xl border border-white/5 p-8 rounded-3xl shadow-2xl">
        <div className="flex justify-center mb-6"><div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20"><Sparkles className="w-8 h-8 text-white" /></div></div>
        <h1 className="text-2xl font-semibold text-center text-white tracking-tight mb-1">SC DEBURRING</h1>
        <p className="text-center text-zinc-500 text-sm mb-6">Access Portal</p>
        <form onSubmit={handleLogin} className="space-y-4"><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Username" autoFocus /><input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" placeholder="PIN" /><button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-medium transition-all shadow-lg shadow-blue-900/20 mt-2 disabled:opacity-50">{loading ? 'Verifying...' : 'Sign In'}</button></form>
      </div>
    </div>
  );
};

// --- COMPONENT: ADMIN DASHBOARD ---
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

// --- APP ROOT ---
export function App() {
  const [user, setUser] = useState<User | null>(() => { try { return JSON.parse(localStorage.getItem('nexus_user') || 'null'); } catch(e) { return null; } });
  const [view, setView] = useState<AppView>('login');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [printable, setPrintable] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState<any>(null);

  useEffect(() => { if(user) localStorage.setItem('nexus_user', JSON.stringify(user)); else localStorage.removeItem('nexus_user'); if(!user) setView('login'); else if(user.role === 'admin' && view === 'login') setView('admin-dashboard'); else if(user.role === 'employee') setView('employee-scan'); }, [user]);
  const addToast = (t: any, m: any) => setToasts(p => [...p, {id: Date.now().toString(), type: t, message: m}]);

  if (!user || view === 'login') return <><PrintStyles /><LoginView onLogin={setUser} addToast={addToast} /><div className="fixed bottom-4 right-4 z-50 pointer-events-none"><div className="pointer-events-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div></>;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans">
       <PrintStyles /><PrintableJobSheet job={printable} onClose={() => setPrintable(null)} /><ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
       {user.role === 'admin' && (
          <aside className="w-64 border-r border-white/5 bg-zinc-950 flex flex-col fixed h-full z-20">
             <div className="p-6 font-bold text-white flex gap-2 items-center"><Sparkles className="text-blue-500"/> NEXUS</div>
             <nav className="px-4 space-y-1">
                {[{id: 'admin-dashboard', l: 'Overview', i: LayoutDashboard}, {id: 'admin-jobs', l: 'Jobs', i: Briefcase}, {id: 'admin-logs', l: 'Logs', i: Calendar}, {id: 'admin-team', l: 'Team', i: Users}, {id: 'admin-settings', l: 'Settings', i: Settings}, {id: 'admin-scan', l: 'Work Station', i: ScanLine}].map(x => <button key={x.id} onClick={() => setView(x.id as any)} className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-bold ${view === x.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}><x.i className="w-4 h-4" /> {x.l}</button>)}
             </nav>
             <button onClick={() => setUser(null)} className="mt-auto m-6 flex items-center gap-3 text-zinc-500 hover:text-white text-sm font-bold"><LogOut className="w-4 h-4" /> Sign Out</button>
          </aside>
       )}
       <main className={`flex-1 p-8 ${user.role === 'admin' ? 'ml-64' : ''}`}>
          {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} />}
          {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} />}
          {view === 'admin-logs' && <LogsView addToast={addToast} />}
          {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
          {view === 'admin-settings' && <SettingsView addToast={addToast} />}
          {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} />}
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} />}
       </main>
       <div className="fixed bottom-6 right-6 z-50 pointer-events-none"><div className="pointer-events-auto flex flex-col items-end gap-2">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div>
    </div>
  );
}

// Internal Admin Helpers
const AdminEmployees = ({ addToast, confirm }: { addToast: any, confirm: any }) => {
   const [users, setUsers] = useState<User[]>([]);
   const [editingUser, setEditingUser] = useState<Partial<User>>({});
   const [showModal, setShowModal] = useState(false);
   useEffect(() => DB.subscribeUsers(setUsers), []);
   const handleSave = async () => { if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'Missing fields'); await DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true }); setShowModal(false); addToast('success', 'User Saved'); };
   return (<div className="space-y-6"><div className="flex justify-between items-center"><h2 className="text-2xl font-bold text-white">Team</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2"><Plus className="w-4 h-4" /> Add Member</button></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{users.map(u => (<div key={u.id} className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400"><UserIcon className="w-5 h-5" /></div><div><p className="font-bold text-white">{u.name}</p><p className="text-xs text-zinc-500">@{u.username} • {u.role}</p></div></div><div className="flex gap-2"><button onClick={() => confirm({ title: "Remove User", message: "Delete this user?", onConfirm: () => DB.deleteUser(u.id) })} className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-500"><Trash2 className="w-4 h-4" /></button><button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button></div></div>))}</div>{showModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"><div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50"><h3 className="font-bold text-white">User Details</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button></div><div className="p-6 space-y-4"><div><label className="text-xs text-zinc-500 ml-1">Full Name</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div><div><label className="text-xs text-zinc-500 ml-1">Username</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div><div><label className="text-xs text-zinc-500 ml-1">PIN</label><input type="text" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div><div><label className="text-xs text-zinc-500 ml-1">Role</label><select className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div></div><div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2"><button onClick={() => setShowModal(false)} className="px-4 py-2 text-zinc-400">Cancel</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-medium">Save</button></div></div></div>)}</div>);
};

const SettingsView = ({ addToast }: { addToast: any }) => {
   const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
   const [newOp, setNewOp] = useState('');
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Updated'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   return (<div className="max-w-xl space-y-6"><h2 className="text-2xl font-bold text-white">System Settings</h2><div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6"><div><label className="text-xs text-zinc-500 block mb-1">Auto-Clock Out Time</label><input type="time" value={settings.autoClockOutTime} onChange={e => setSettings({...settings, autoClockOutTime: e.target.value})} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" /></div></div><div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6"><h3 className="font-bold text-white">Production Operations</h3><div className="space-y-4"><div className="flex gap-2"><input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="New Op..." className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" /><button onClick={handleAddOp} className="bg-blue-600 px-4 rounded-lg text-white"><Plus className="w-4 h-4" /></button></div><div className="flex flex-wrap gap-2">{settings.customOperations?.map(op => (<div key={op} className="bg-zinc-800 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2"><span>{op}</span><button onClick={() => setSettings({...settings, customOperations: settings.customOperations.filter(o => o !== op)})} className="text-zinc-500 hover:text-red-500"><X className="w-3 h-3" /></button></div>))}</div></div></div><div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2"><Save className="w-5 h-5" /> Save Changes</button></div></div>);
};
