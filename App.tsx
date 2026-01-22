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
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hour}:${min}`;
};

// --- PRINT STYLES ---
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
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        z-index: 9999999 !important;
        color: black !important;
        display: block !important;
      }
      .no-print {
        display: none !important;
      }
      @page {
        size: portrait;
        margin: 10mm;
      }
    }
  `}</style>
);

// --- COMPONENT: LIVE TIMER ---
const LiveTimer = ({ startTime }: { startTime: number }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, [startTime]);

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;

  return (
    <div className="font-mono tabular-nums">
      {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </div>
  );
};

// --- COMPONENT: ACTIVE JOB PANEL ---
const ActiveJobPanel = ({ job, log, onStop }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void> }) => {
  const [isStopping, setIsStopping] = useState(false);

  const handleStopClick = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
        await onStop(log.id);
    } catch (e) {
        setIsStopping(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl md:rounded-[40px] p-6 md:p-10 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 via-purple-500 to-blue-600 opacity-50 animate-pulse"></div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 relative z-10">
        <div className="flex flex-col justify-center">
           <div className="flex items-center gap-2 mb-4">
              <span className="animate-pulse w-3 h-3 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]"></span>
              <span className="text-red-400 font-black uppercase tracking-[0.2em] text-[10px] md:text-xs">Live Floor Phase</span>
           </div>
           
           <h2 className="text-4xl md:text-7xl font-black text-white mb-2 tracking-tighter leading-none">{job ? job.jobIdsDisplay : 'UNKNOWN_BATCH'}</h2>
           <div className="text-xl md:text-3xl text-blue-400 font-black mb-8 flex items-center gap-3">
             <span className="px-5 py-1.5 bg-blue-500/10 rounded-2xl border border-blue-500/20">{log.operation}</span>
           </div>
           
           <div className="bg-black/60 rounded-3xl p-6 md:p-8 border border-white/10 mb-8 w-full max-w-md flex items-center justify-between shadow-[inset_0_4px_12px_rgba(0,0,0,0.5)]">
              <div>
                <p className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-[0.3em] mb-2 opacity-60">Cycle Duration</p>
                <div className="text-white text-4xl md:text-6xl font-black tracking-widest leading-none"><LiveTimer startTime={log.startTime} /></div>
              </div>
              <Clock className="w-8 md:w-12 h-8 md:h-12 text-zinc-800" />
           </div>

           <button 
             onClick={handleStopClick} 
             disabled={isStopping}
             className="w-full max-w-md bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-5 rounded-[24px] font-black uppercase tracking-[0.4em] text-sm md:text-base flex items-center justify-center gap-4 shadow-2xl shadow-red-900/40 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
           >
              {isStopping ? 'TERMINATING...' : <><StopCircle className="w-6 h-6" /> END CURRENT SESSION</>}
           </button>
        </div>

        <div className="bg-white/[0.03] rounded-[32px] p-6 md:p-10 border border-white/5 flex flex-col h-full backdrop-blur-xl shadow-inner relative group">
           <div className="absolute top-0 right-0 p-8 opacity-5"><Activity className="w-32 h-32" /></div>
           <h3 className="text-zinc-500 font-black uppercase text-[10px] md:text-xs mb-8 flex items-center gap-3 tracking-[0.3em]">
             <Info className="w-4 h-4 text-blue-500" /> Production Matrix
           </h3>
           {job ? (
             <>
               <div className="grid grid-cols-2 gap-y-8 md:gap-y-10 gap-x-8">
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-600 uppercase font-black tracking-widest">Part Index</label>
                    <div className="text-xl md:text-3xl font-black text-white mt-2 break-words leading-none tracking-tight">{job.partNumber}</div>
                  </div>
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-600 uppercase font-black tracking-widest">Order Ref</label>
                    <div className="text-xl md:text-3xl font-black text-white mt-2 break-words leading-none tracking-tight">{job.poNumber}</div>
                  </div>
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-600 uppercase font-black tracking-widest">Lot Size</label>
                    <div className="text-xl md:text-3xl font-black text-blue-500 mt-2 leading-none">{job.quantity} <span className="text-xs font-bold text-zinc-600 ml-1">UNITS</span></div>
                  </div>
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-600 uppercase font-black tracking-widest">Deadline</label>
                    <div className="text-xl md:text-3xl font-black text-red-500 mt-2 leading-none">{job.dueDate || 'N/A'}</div>
                  </div>
               </div>
               
               <div className="mt-auto pt-10 border-t border-white/10">
                 <label className="text-[10px] md:text-xs text-zinc-600 uppercase font-black tracking-widest mb-4 block">Standard Operating Procedure</label>
                 <div className="text-zinc-400 text-xs md:text-sm leading-relaxed bg-black/40 p-5 rounded-2xl border border-white/5 min-h-[100px] italic shadow-inner">
                   {job.info || "Standard production protocols apply. Ensure QC validation before batch transfer."}
                 </div>
               </div>
             </>
           ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-zinc-700 p-8 text-center opacity-50">
               <AlertCircle className="w-16 h-16 mb-4" />
               <p className="font-black text-xl">NULL_DATA</p>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

// --- HELPER COMPONENT: JOB CARD (EMPLOYEE VIEW) ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-zinc-900/40 border border-white/10 rounded-3xl overflow-hidden transition-all duration-500 ${expanded ? 'ring-2 ring-blue-500/50 bg-zinc-800 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] scale-[1.02]' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
      <div 
        className="p-6 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-start mb-4 gap-4">
          <h3 className="text-xl font-black text-white truncate tracking-tighter leading-none uppercase">{job.jobIdsDisplay}</h3>
          <span className="bg-zinc-950 text-blue-500 text-[10px] px-3 py-1 rounded-full font-black border border-blue-500/20 shrink-0">{job.quantity} PCS</span>
        </div>
        <div className="text-[11px] text-zinc-500 space-y-2 font-black uppercase tracking-widest opacity-80">
          <p className="truncate">Part: <span className="text-white">{job.partNumber}</span></p>
          <p className="truncate">PO: <span className="text-zinc-300">{job.poNumber}</span></p>
        </div>
        
        {!expanded && (
          <div className="mt-6 flex items-center text-blue-500 text-[10px] font-black uppercase tracking-[0.3em] border-t border-white/5 pt-4">
            INITIATE WORKFLOW <ArrowRight className="w-4 h-4 ml-auto group-hover:translate-x-1 transition-transform" />
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-5 bg-zinc-950/60 border-t border-white/10 animate-fade-in shadow-inner">
          <p className="text-[10px] text-zinc-600 uppercase font-black mb-4 tracking-[0.3em] text-center">Select Current Phase:</p>
          <div className="grid grid-cols-2 gap-3">
            {operations.map(op => (
              <button
                key={op}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(job.id, op);
                }}
                className="bg-zinc-900 hover:bg-blue-600 hover:text-white border border-white/5 py-4 px-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 text-zinc-400 shadow-xl"
              >
                {op}
              </button>
            ))}
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
    const settings = DB.getSettings();
    setOps(settings.customOperations || []);
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

      <div className="flex justify-between items-center bg-zinc-900/60 backdrop-blur-2xl p-3 rounded-[32px] border border-white/10 sticky top-6 z-30 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)]">
         <div className="flex gap-2">
           <button onClick={() => setTab('jobs')} className={`px-6 py-3 rounded-[20px] text-[10px] font-black uppercase tracking-[0.2em] transition-all ${tab === 'jobs' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-500 hover:text-white'}`}>Active Batches</button>
           <button onClick={() => setTab('history')} className={`px-6 py-3 rounded-[20px] text-[10px] font-black uppercase tracking-[0.2em] transition-all ${tab === 'history' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-500 hover:text-white'}`}>Personal Logs</button>
         </div>
         <div className="flex gap-3">
             <button onClick={() => setTab('scan')} className={`p-3 rounded-[20px] transition-all shadow-xl ${tab === 'scan' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-blue-500 hover:bg-zinc-700'}`}><ScanLine className="w-6 h-6" /></button>
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 p-3 rounded-[20px] hover:bg-red-600 hover:text-white transition-all shadow-xl"><LogOut className="w-6 h-6" /></button>
         </div>
      </div>

      {tab === 'scan' ? (
         <div className="py-20 animate-fade-in flex justify-center">
            <div className="bg-zinc-900/60 p-12 rounded-[64px] border border-white/10 text-center max-w-md w-full shadow-2xl backdrop-blur-xl">
               <div className="w-24 h-24 bg-blue-600/10 rounded-[32px] flex items-center justify-center mx-auto mb-8 shadow-inner border border-blue-500/20"><QrCode className="w-12 h-12 text-blue-500 animate-pulse" /></div>
               <h2 className="text-3xl font-black text-white mb-3 uppercase tracking-tight">TERMINAL_READY</h2>
               <p className="text-zinc-500 text-[10px] font-black mb-10 tracking-[0.4em] uppercase opacity-60 underline underline-offset-8 decoration-blue-500/50">Align Traveler barcode</p>
               <input autoFocus onKeyDown={(e) => { if(e.key === 'Enter') { setSearch(e.currentTarget.value); setTab('jobs'); e.currentTarget.value = ''; } }} className="bg-black/60 border-2 border-white/5 rounded-[24px] px-8 py-5 text-white text-center w-full text-xl font-black focus:border-blue-600 outline-none transition-all shadow-inner tracking-widest placeholder-zinc-800" placeholder="---" />
            </div>
         </div>
      ) : tab === 'history' ? (
        <div className="bg-zinc-900/40 border border-white/10 rounded-[40px] overflow-hidden shadow-2xl backdrop-blur-xl">
           <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-zinc-950/80 text-zinc-600 font-black uppercase tracking-[0.3em] text-[10px]"><tr><th className="p-6">Cycle Date</th><th className="p-6">Batch ID</th><th className="p-6">Phase</th><th className="p-6">Total Time</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {myHistory.map(log => (
                  <tr key={log.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="p-6 text-zinc-500 font-black uppercase text-xs">{new Date(log.startTime).toLocaleDateString()}</td>
                    <td className="p-6 text-white font-black tracking-tight text-base uppercase">{log.jobId}</td>
                    <td className="p-6 text-zinc-400 font-black uppercase tracking-widest text-[10px]">{log.operation}</td>
                    <td className="p-6 text-blue-500 font-black font-mono text-lg">{formatDuration(log.durationMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
           </div>
        </div>
      ) : (
        <div className="animate-fade-in space-y-8">
          <div className="relative group">
            <Search className="absolute left-6 top-5 w-6 h-6 text-zinc-700 group-focus-within:text-blue-500 transition-colors" />
            <input type="text" placeholder="FILTER PRODUCTION PIPELINE..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/5 rounded-[32px] pl-16 pr-8 py-5 text-white font-black uppercase tracking-[0.3em] text-xs focus:ring-4 focus:ring-blue-600/10 focus:border-blue-600 outline-none shadow-2xl transition-all"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredJobs.map(job => <JobSelectionCard key={job.id} job={job} onStart={DB.startTimeLog} disabled={!!activeLog} operations={ops} />)}
            {filteredJobs.length === 0 && <div className="col-span-full py-20 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.5em] opacity-40">Pipeline clear</div>}
          </div>
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
        <div className="grid grid-cols-2 gap-4">
          <button onClick={onCancel} className="bg-zinc-800 text-zinc-500 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:text-white transition-all shadow-xl">Abort</button>
          <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-2xl shadow-red-900/40 hover:bg-red-500 transition-all">Confirm</button>
        </div>
      </div>
    </div>
  );
};

// --- PRINTABLE JOB SHEET ---
const PrintableJobSheet = ({ job, onClose }: { job: Job | null, onClose: () => void }) => {
  if (!job) return null;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(window.location.href.split('?')[0] + '?jobId=' + job.id)}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-2xl p-4 animate-fade-in overflow-y-auto no-print-background">
      <div className="bg-white text-black w-full max-w-4xl rounded-[40px] shadow-2xl relative flex flex-col min-h-[90vh] md:min-h-0" id="printable-area-root">
         
         <div className="bg-zinc-950 text-white p-6 flex justify-between items-center no-print shrink-0 border-b border-white/10 rounded-t-[40px]">
             <div className="flex items-center gap-4">
               <div className="w-12 h-12 rounded-[18px] bg-blue-600 flex items-center justify-center shadow-2xl"><Printer className="w-6 h-6" /></div>
               <div><h3 className="font-black text-base uppercase tracking-tight">System Traveler Output</h3><p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.3em] opacity-60">Ready for physical log</p></div>
             </div>
             <div className="flex gap-3">
                 <button onClick={onClose} className="px-6 py-3 text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-widest">Discard</button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-3 shadow-2xl transition-all active:scale-95"><Printer className="w-5 h-5"/> COMMENCE PRINT</button>
             </div>
         </div>

         <div className="flex-1 p-12 md:p-20 bg-white flex flex-col text-black">
            <div className="flex justify-between items-start border-b-[10px] border-black pb-10 mb-12">
              <div>
                 <h1 className="text-7xl font-black tracking-tighter leading-none mb-6">SC DEBURRING</h1>
                 <p className="text-base font-black uppercase tracking-[0.5em] bg-black text-white px-4 py-2 w-fit">Production Traveler</p>
              </div>
              <div className="text-right">
                 <div className="text-4xl font-black">{new Date().toLocaleDateString()}</div>
                 <div className="text-[11px] uppercase font-black text-gray-400 mt-3 tracking-[0.4em]">Official Job Matrix</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 flex-1">
               <div className="space-y-10">
                   <div className="border-[8px] border-black p-10 bg-gray-50 shadow-[12px_12px_0px_rgba(0,0,0,0.1)] relative">
                      <div className="absolute top-0 right-0 p-4 opacity-5"><Activity className="w-20 h-20" /></div>
                      <label className="block text-xs uppercase font-black text-gray-400 mb-3 tracking-[0.3em]">Purchase Order Ref</label>
                      <div className="text-6xl md:text-8xl font-black leading-none break-all tracking-tighter">{job.poNumber}</div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-8">
                      <div className="border-[5px] border-gray-100 p-6 shadow-inner"><label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Part Index</label><div className="text-2xl font-black truncate tracking-tighter uppercase">{job.partNumber}</div></div>
                      <div className="border-[5px] border-gray-100 p-6 shadow-inner"><label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Batch Qty</label><div className="text-4xl font-black leading-none">{job.quantity}</div></div>
                      <div className="border-[5px] border-gray-100 p-6 shadow-inner"><label className="block text-[10px] uppercase font-black text-gray-400 mb-2 tracking-widest">Inbound Date</label><div className="text-xl font-bold">{job.dateReceived || '-'}</div></div>
                      <div className="border-[5px] border-red-50 p-6 shadow-inner"><label className="block text-[10px] uppercase font-black text-red-600 mb-2 tracking-widest uppercase">Target Date</label><div className="text-3xl font-black text-red-600 underline underline-offset-8 decoration-4">{job.dueDate || 'PRIORITY'}</div></div>
                   </div>

                   <div className="border-t-[6px] border-black pt-10">
                     <label className="block text-xs uppercase font-black text-gray-400 mb-6 tracking-[0.3em]">Specialized Protocols / Floor Notes</label>
                     <div className="text-2xl leading-relaxed p-10 bg-gray-50 min-h-[250px] border-2 border-dashed border-gray-200 font-bold uppercase tracking-tight italic text-gray-400">
                       {job.info || "Follow standard deburring and polishing phases. Ensure count verification before seal."}
                     </div>
                   </div>
               </div>
               
               <div className="flex flex-col items-center justify-center border-[16px] border-black p-12 bg-white h-full relative group">
                  <div className="w-full aspect-square flex items-center justify-center">
                    <img src={qrUrl} alt="QR" className="w-full h-full object-contain" crossOrigin="anonymous" />
                  </div>
                  <div className="mt-12 text-center space-y-4 w-full">
                    <p className="font-mono text-3xl font-black tracking-tighter text-gray-200 break-all border-b-4 border-gray-50 pb-6">{job.id}</p>
                    <p className="font-black uppercase tracking-[0.6em] text-4xl md:text-5xl pt-6 leading-none">SCAN_BATCH</p>
                    <p className="text-xs text-gray-300 font-black uppercase tracking-[0.5em] mt-8">SC DEBURRING CORE SYSTEM</p>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

// --- LOGIN ---
const LoginView = ({ onLogin, addToast }: any) => {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleLogin = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    const user = await DB.loginUser(username, pin);
    if (user) { onLogin(user); addToast('success', `SYSTEM ACCESS_GRANTED: ${user.name}`); }
    else { addToast('error', 'DENIED: INVALID_PROTOCOLS'); setPin(''); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent opacity-40"></div>
      <div className="w-full max-w-md bg-zinc-900/40 backdrop-blur-3xl border border-white/10 p-12 rounded-[64px] shadow-[0_48px_128px_-32px_rgba(0,0,0,0.7)] relative z-10">
        <div className="flex justify-center mb-10">
          <div className="w-24 h-24 rounded-[32px] bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-[0_0_60px_rgba(37,99,235,0.5)] animate-pulse relative group">
            <div className="absolute inset-0 rounded-[32px] bg-white opacity-10 group-hover:opacity-20 transition-opacity"></div>
            <Sparkles className="w-12 h-12 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-black text-center text-white tracking-tighter mb-2 uppercase">SC DEBURRING</h1>
        <p className="text-center text-zinc-600 text-[10px] font-black uppercase tracking-[0.5em] mb-12 opacity-60">Master Command Central</p>
        
        <form onSubmit={handleLogin} className="space-y-6">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/50 border border-white/5 rounded-3xl px-8 py-5 text-white font-black tracking-widest focus:border-blue-600 outline-none transition-all shadow-inner placeholder-zinc-800 text-sm" placeholder="ID_HANDLE" autoFocus />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/50 border border-white/5 rounded-3xl px-8 py-5 text-white font-black tracking-[1em] focus:border-blue-600 outline-none transition-all shadow-inner placeholder-zinc-800 text-sm" placeholder="••••" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-3xl font-black uppercase tracking-[0.4em] transition-all shadow-2xl shadow-blue-900/40 mt-6 disabled:opacity-50 active:scale-95 text-xs">
            {loading ? 'VALIDATING...' : 'COMMENCE_BOOT'}
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

   return (
      <div className="space-y-10 animate-fade-in">
         {activeLogs.find(l => l.userId === user.id) && (
            <ActiveJobPanel 
              job={jobs.find(j => j.id === activeLogs.find(l => l.userId === user.id)?.jobId) || null} 
              log={activeLogs.find(l => l.userId === user.id)!} 
              onStop={DB.stopTimeLog} 
            />
         )}

         <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { label: 'Active Pipeline', val: new Set(activeLogs.map(l => l.jobId)).size, sub: 'LIVE_PHASE', icon: Activity, color: 'text-blue-500', glow: 'shadow-[0_0_30px_rgba(59,130,246,0.2)]' },
              { label: 'Production Queue', val: jobs.filter(j => j.status === 'in-progress').length, sub: 'TOTAL_WIP', icon: Briefcase, color: 'text-zinc-500', glow: 'shadow-none' },
              { label: 'Deployed Staff', val: new Set(activeLogs.map(l => l.userId)).size, sub: 'CLOCKED_ON', icon: Users, color: 'text-emerald-500', glow: 'shadow-[0_0_30px_rgba(16,185,129,0.1)]' }
            ].map((s, i) => (
              <div key={i} className={`bg-zinc-900/40 border border-white/10 p-10 rounded-[48px] flex justify-between items-center shadow-2xl backdrop-blur-xl ${s.glow}`}>
                 <div>
                     <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.4em] mb-2 opacity-60">{s.label}</p>
                     <h3 className="text-5xl font-black text-white tracking-tighter leading-none">{s.val}</h3>
                     <p className={`text-[10px] uppercase font-black mt-3 tracking-[0.2em] ${s.color}`}>{s.sub}</p>
                 </div>
                 <s.icon className={`w-12 h-12 ${s.color} ${s.label === 'Active Pipeline' && s.val > 0 ? 'animate-pulse' : 'opacity-20'}`} />
              </div>
            ))}
         </div>
         
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
             <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden flex flex-col h-full shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <div className="p-8 md:p-10 border-b border-white/5 flex items-center justify-between bg-zinc-950/20"><h3 className="font-black text-white uppercase tracking-tight flex items-center gap-4 text-lg">Active Terminal States</h3></div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[500px] custom-scrollbar">
                   {activeLogs.length === 0 && <div className="p-20 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.5em] opacity-40">System state idle</div>}
                   {activeLogs.map(l => (
                      <div key={l.id} className="p-8 flex items-center justify-between hover:bg-white/[0.02] transition-all group">
                         <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-3xl bg-zinc-800 flex items-center justify-center font-black text-zinc-500 border border-white/10 text-lg shadow-inner group-hover:border-blue-500/50 transition-colors">{l.userName.charAt(0)}</div>
                            <div>
                                <p className="font-black text-white text-lg tracking-tight leading-none mb-1.5 uppercase">{l.userName}</p>
                                <p className="text-[10px] text-blue-500 font-black uppercase tracking-[0.3em]">{l.operation}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-6">
                            <div className="text-white text-2xl md:text-3xl font-black font-mono tracking-widest shadow-lg leading-none">{formatDuration(Math.floor((Date.now() - l.startTime) / 60000))}</div>
                            <button onClick={() => confirmAction({ title: "Force Termination", message: "Hard-stop this active cycle?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-4 rounded-2xl hover:bg-red-600 hover:text-white transition-all shadow-xl shadow-red-900/20"><Power className="w-6 h-6" /></button>
                         </div>
                      </div>
                   ))}
                </div>
             </div>

             <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden flex flex-col h-full shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <div className="p-8 md:p-10 border-b border-white/5 flex justify-between items-center bg-zinc-950/20">
                    <h3 className="font-black text-white uppercase tracking-tight flex items-center gap-4 text-lg">Event Stream</h3>
                    <button onClick={() => setView('admin-logs')} className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500 hover:text-white transition-colors underline underline-offset-4 decoration-blue-500/20">System Logs</button>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[500px] custom-scrollbar">
                   {logs.length === 0 && <div className="p-20 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.5em] opacity-40">No historical activity</div>}
                   {logs.map(l => (
                       <div key={l.id} className="p-8 flex items-start gap-6 hover:bg-white/[0.02] transition-all">
                           <div className={`mt-2 w-2.5 h-2.5 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-700' : 'bg-emerald-500 animate-pulse'}`}></div>
                           <div className="flex-1">
                               <p className="text-sm md:text-base text-white font-black uppercase tracking-tight leading-none mb-1">
                                   <span className="text-blue-500">{l.userName}</span> {l.endTime ? 'FINALIZED' : 'COMMENCED'} <span className="text-zinc-400 font-bold">{l.operation}</span>
                               </p>
                               <p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] mt-2 opacity-80">Reference: {l.jobId} • {new Date(l.startTime).toLocaleTimeString()}</p>
                           </div>
                           {l.durationMinutes && <div className="text-[12px] font-black font-mono text-zinc-500 bg-black/40 px-4 py-2 rounded-2xl border border-white/5 shadow-inner uppercase">{formatDuration(l.durationMinutes)}</div>}
                       </div>
                   ))}
                </div>
             </div>
         </div>
      </div>
   );
};

// --- ADMIN: JOBS (CATEGORIZED & FILTERABLE) ---
const JobsView = ({ user, addToast, setPrintable, confirm }: any) => {
   const [jobs, setJobs] = useState<Job[]>([]);
   const [subTab, setSubTab] = useState<'active' | 'archive'>('active');
   const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'year' | 'all'>('week');
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [isSaving, setIsSaving] = useState(false);
   const [search, setSearch] = useState('');
   const [ops, setOps] = useState<string[]>([]);

   useEffect(() => {
       const u1 = DB.subscribeJobs(setJobs);
       setOps(DB.getSettings().customOperations);
       return () => u1();
   }, []);

   const filteredJobs = useMemo(() => {
       const term = search.toLowerCase();
       const now = Date.now();
       const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
       const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;
       const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

       return jobs.filter(j => {
           // Basic search filter
           const matchesSearch = JSON.stringify(j).toLowerCase().includes(term);
           if (!matchesSearch) return false;

           // Categorical separation
           if (subTab === 'active') {
               return j.status !== 'completed';
           } else {
               if (j.status !== 'completed') return false;
               
               // Archive Temporal Filtering
               if (timeFilter === 'all') return true;
               const timestamp = j.completedAt || j.createdAt;
               const diff = now - timestamp;
               if (timeFilter === 'week') return diff <= ONE_WEEK;
               if (timeFilter === 'month') return diff <= ONE_MONTH;
               if (timeFilter === 'year') return diff <= ONE_YEAR;
               return true;
           }
       }).sort((a,b) => {
           if (subTab === 'active') {
               // Put in-progress at top
               if (a.status === 'in-progress' && b.status !== 'in-progress') return -1;
               if (a.status !== 'in-progress' && b.status === 'in-progress') return 1;
           }
           return b.createdAt - a.createdAt;
       });
   }, [jobs, search, subTab, timeFilter]);

   const handleSave = async () => {
    if (!editingJob.jobIdsDisplay || !editingJob.partNumber) return addToast('error', 'DATA_MISMATCH: FIELDS_REQUIRED');
    setIsSaving(true);
    await DB.saveJob({
      id: editingJob.id || Date.now().toString(),
      jobIdsDisplay: editingJob.jobIdsDisplay,
      poNumber: editingJob.poNumber || '',
      partNumber: editingJob.partNumber,
      quantity: editingJob.quantity || 0,
      dueDate: editingJob.dueDate || '',
      info: editingJob.info || '',
      status: editingJob.status || 'pending',
      dateReceived: editingJob.dateReceived || new Date().toISOString().split('T')[0],
      createdAt: editingJob.createdAt || Date.now()
    } as Job);
    addToast('success', 'RECORD_COMMITTED');
    setShowModal(false);
    setIsSaving(false);
   };

   return (
      <div className="space-y-8 animate-fade-in">
         <div className="flex flex-col lg:flex-row justify-between lg:items-end gap-8">
            <div>
               <h2 className="text-5xl font-black flex items-center gap-4 uppercase tracking-tighter text-white leading-none mb-4">Industrial Floor</h2>
               <div className="flex gap-4 p-1.5 bg-zinc-900/60 border border-white/5 rounded-2xl w-fit backdrop-blur-xl">
                  <button onClick={() => setSubTab('active')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${subTab === 'active' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Active Production</button>
                  <button onClick={() => setSubTab('archive')} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${subTab === 'archive' ? 'bg-blue-600 text-white shadow-xl' : 'text-zinc-600 hover:text-white'}`}>Archived Records</button>
               </div>
            </div>
            
            <div className="flex gap-4 flex-wrap lg:justify-end items-center">
                {subTab === 'archive' && (
                    <div className="flex gap-2 p-1 bg-black/40 border border-white/5 rounded-xl mr-2">
                        {['week', 'month', 'year', 'all'].map(t => (
                            <button key={t} onClick={() => setTimeFilter(t as any)} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${timeFilter === t ? 'bg-zinc-800 text-blue-400' : 'text-zinc-600 hover:text-zinc-400'}`}>{t}</button>
                        ))}
                    </div>
                )}
                <div className="relative flex-1 lg:flex-initial shadow-2xl">
                    <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-700" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="FILTER PO / JOB / PART..." className="pl-14 pr-6 py-4 bg-zinc-900 border border-white/5 rounded-[24px] text-[10px] font-black uppercase tracking-[0.3em] text-white w-full lg:w-80 focus:ring-4 focus:ring-blue-600/10 outline-none backdrop-blur-xl transition-all" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-8 py-4 rounded-[24px] text-[10px] font-black uppercase tracking-[0.4em] text-white flex items-center gap-3 hover:bg-blue-500 shadow-2xl shadow-blue-900/40 transition-all active:scale-95"><Plus className="w-5 h-5"/> Recruit Batch</button>
            </div>
         </div>
         
         <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] overflow-hidden shadow-[0_48px_128px_-32px_rgba(0,0,0,0.7)] backdrop-blur-xl">
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-950/80 text-zinc-600 font-black uppercase tracking-[0.4em] text-[10px]">
                        <tr>
                            <th className="p-8">Reference PO</th>
                            <th className="p-8">Sequence ID</th>
                            <th className="p-8">Technical Index</th>
                            <th className="p-8">Unit Load</th>
                            <th className="p-8">Status State</th>
                            <th className="p-8 text-right">Operational Controls</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {filteredJobs.map(j => (
                           <tr key={j.id} className="hover:bg-white/[0.04] transition-all group">
                              <td className="p-8 text-white font-black text-2xl tracking-tighter leading-none break-all max-w-[250px] uppercase">{j.poNumber}</td>
                              <td className="p-8 text-zinc-500 font-mono font-black text-base tracking-tighter opacity-80">{j.jobIdsDisplay}</td>
                              <td className="p-8 text-zinc-500 font-black uppercase tracking-[0.2em] text-[11px] truncate max-w-[180px]">{j.partNumber}</td>
                              <td className="p-8 text-blue-500 font-black font-mono text-2xl leading-none">{j.quantity}</td>
                              <td className="p-8">
                                  <span className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.3em] flex w-fit items-center gap-3 border shadow-2xl backdrop-blur-md ${j.status === 'in-progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]' : j.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>
                                      {j.status === 'in-progress' && <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_12px_#3b82f6]"/>}
                                      {j.status}
                                  </span>
                              </td>
                              <td className="p-8 text-right">
                                 <div className="flex justify-end gap-3 opacity-40 group-hover:opacity-100 transition-all">
                                    {j.status !== 'completed' ? (
                                        <button onClick={() => confirm({ title: "Finalize Production", message: "Archive this batch output?", onConfirm: () => DB.completeJob(j.id) })} className="p-4 bg-emerald-500/10 text-emerald-500 rounded-3xl hover:bg-emerald-500 hover:text-white transition-all shadow-2xl border border-emerald-500/20" title="Finalize"><CheckCircle className="w-5 h-5"/></button>
                                    ) : (
                                        <button onClick={() => confirm({ title: "Reactivate Batch", message: "Move batch back to active floor?", onConfirm: () => DB.reopenJob(j.id) })} className="p-4 bg-blue-500/10 text-blue-500 rounded-3xl hover:bg-blue-500 hover:text-white transition-all shadow-2xl border border-blue-500/20" title="Reopen"><RotateCcw className="w-5 h-5"/></button>
                                    )}
                                    <button onClick={() => setPrintable(j)} className="p-4 bg-zinc-800 text-zinc-500 rounded-3xl hover:bg-zinc-700 hover:text-white transition-all shadow-2xl border border-white/5" title="Traveler"><Printer className="w-5 h-5"/></button>
                                    <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-4 bg-blue-500/10 text-blue-400 rounded-3xl hover:bg-blue-500 hover:text-white transition-all shadow-2xl border border-blue-500/20" title="Edit"><Edit2 className="w-5 h-5"/></button>
                                    <button onClick={() => confirm({ title: "Destructive Purge", message: "Permanently erase this production record?", onConfirm: () => DB.deleteJob(j.id) })} className="p-4 bg-red-500/10 text-red-500 rounded-3xl hover:bg-red-600 hover:text-white transition-all shadow-2xl border border-red-500/20" title="Purge"><Trash2 className="w-5 h-5"/></button>
                                 </div>
                              </td>
                           </tr>
                        ))}
                        {filteredJobs.length === 0 && <tr><td colSpan={6} className="p-32 text-center text-zinc-800 text-sm font-black uppercase tracking-[0.6em] opacity-40">Section null</td></tr>}
                    </tbody>
                </table>
            </div>
         </div>

         {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-[64px] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-10 border-b border-white/5 flex justify-between items-center bg-zinc-950/40">
              <div><h3 className="font-black text-white uppercase text-2xl tracking-tight leading-none">Job Specification</h3><p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-3">Production Matrix Sequence</p></div>
              <button onClick={() => setShowModal(false)} className="p-4 bg-white/5 rounded-[24px] text-zinc-600 hover:text-white transition-all"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-10 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-3">
                <label className="text-[10px] text-blue-500 font-black uppercase tracking-[0.4em] ml-2">Purchase Order Ref</label>
                <input className="w-full bg-black/60 border-2 border-white/5 rounded-[24px] p-6 text-white text-3xl font-black focus:border-blue-600 outline-none transition-all shadow-inner tracking-tight uppercase" placeholder="PO_---" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Job Index</label><input className="w-full bg-black/40 border border-white/5 rounded-[24px] p-5 text-sm font-black text-white shadow-inner uppercase tracking-widest" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Part Catalog #</label><input className="w-full bg-black/40 border border-white/5 rounded-[24px] p-5 text-sm font-black text-white shadow-inner uppercase tracking-widest" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Batch Load</label><input type="number" className="w-full bg-black/40 border border-white/5 rounded-[24px] p-5 text-lg font-black text-blue-500 shadow-inner" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Floor Deadline</label><input type="date" className="w-full bg-zinc-800 border border-white/5 rounded-[24px] p-5 text-xs font-black text-white shadow-inner" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
              </div>
              <div className="space-y-3"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em] ml-2">Technical Commentary</label><textarea className="w-full bg-black/40 border border-white/5 rounded-[32px] p-6 text-xs font-bold text-zinc-400 shadow-inner italic" rows={4} placeholder="Describe operational specifics..." value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
            </div>
            <div className="p-10 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-5">
              <button onClick={() => setShowModal(false)} className="px-8 py-4 text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all">Discard</button>
              <button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.4em] disabled:opacity-50 shadow-2xl shadow-blue-900/40 active:scale-95 transition-all">{isSaving ? 'SYNCING_STATE...' : 'COMMIT_SPEC'}</button>
            </div>
          </div>
        </div>
      )}
      </div>
   )
}

// --- ADMIN: LOGS ---
const LogsView = ({ addToast }: { addToast: any }) => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [users, setUsers] = useState<User[]>([]);
   const [refreshKey, setRefreshKey] = useState(0);
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
   const [showEditModal, setShowEditModal] = useState(false);
   const [ops, setOps] = useState<string[]>([]);

   useEffect(() => {
     const unsub1 = DB.subscribeLogs(setLogs);
     const unsub3 = DB.subscribeUsers(setUsers);
     setOps(DB.getSettings().customOperations);
     return () => { unsub1(); unsub3(); };
   }, [refreshKey]);

   const handleSaveLog = async () => {
       if (!editingLog) return;
       if (editingLog.endTime && editingLog.endTime < editingLog.startTime) return addToast('error', 'TEMPORAL_CONFLICT: REVERSE_TIME');
       await DB.updateTimeLog(editingLog);
       addToast('success', 'ARCHIVE_VALIDATED');
       setShowEditModal(false);
   };

   return (
      <div className="space-y-10 animate-fade-in">
         <div className="flex justify-between items-center">
             <h2 className="text-4xl font-black flex items-center gap-5 uppercase tracking-tighter text-white leading-none">System Archive</h2>
             <button onClick={() => setRefreshKey(k => k + 1)} className="p-4 bg-zinc-900/60 border border-white/10 rounded-[24px] text-zinc-600 hover:text-white transition-all shadow-2xl backdrop-blur-xl group" title="Reload Global State"><RefreshCw className="w-6 h-6 group-hover:rotate-180 transition-transform duration-700" /></button>
         </div>

         <div className="bg-zinc-900/40 border border-white/10 rounded-[56px] overflow-hidden shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] backdrop-blur-xl">
             <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-950/80 text-zinc-600 font-black uppercase tracking-[0.4em] text-[10px]"><tr><th className="p-8">Timestamp</th><th className="p-8">Phase Start</th><th className="p-8">Phase End</th><th className="p-8">Operator</th><th className="p-8">Workflow Phase</th><th className="p-8 text-right">Edit</th></tr></thead>
                    <tbody className="divide-y divide-white/5">
                    {logs.map(l => (
                        <tr key={l.id} className="hover:bg-white/[0.04] transition-all">
                            <td className="p-8 text-zinc-500 font-black text-sm whitespace-nowrap uppercase">{new Date(l.startTime).toLocaleDateString()}</td>
                            <td className="p-8 font-mono text-zinc-300 whitespace-nowrap text-base font-black tracking-widest">{new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                            <td className="p-8 font-mono text-zinc-300 whitespace-nowrap text-base font-black tracking-widest">{l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : <span className="text-emerald-500 font-black tracking-[0.4em] text-[10px] animate-pulse bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">LIVE_SESSION</span>}</td>
                            <td className="p-8 text-white font-black uppercase tracking-tight text-lg truncate max-w-[150px] leading-none">{l.userName}</td>
                            <td className="p-8 text-blue-500 font-black uppercase tracking-[0.3em] text-[11px]">{l.operation}</td>
                            <td className="p-8 text-right">
                                <button onClick={() => { setEditingLog({...l}); setShowEditModal(true); }} className="p-4 bg-zinc-800/50 rounded-2xl text-zinc-600 hover:text-white transition-all shadow-2xl border border-white/5"><Edit2 className="w-5 h-5"/></button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
             </div>
         </div>

         {showEditModal && editingLog && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
                 <div className="bg-zinc-900 border border-white/10 w-full max-w-xl rounded-[64px] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] overflow-hidden">
                     <div className="p-10 border-b border-white/5 flex justify-between items-center bg-zinc-950/40 uppercase font-black tracking-tighter">
                         <h3 className="font-bold text-white flex items-center gap-4 text-xl"><Edit2 className="w-6 h-6 text-blue-500" /> Administrative Adjust</h3>
                         <button onClick={() => setShowEditModal(false)} className="p-4 bg-white/5 rounded-2xl text-zinc-600 hover:text-white transition-all"><X className="w-6 h-6" /></button>
                     </div>
                     <div className="p-10 space-y-8">
                         <div className="space-y-3"><label className="text-[10px] text-zinc-600 uppercase font-black tracking-[0.4em] ml-2 block">Personnel Selection</label><select className="w-full bg-black/50 border border-white/5 rounded-[24px] p-6 text-white text-base font-black outline-none focus:border-blue-600 transition-all shadow-inner" value={editingLog.userId} onChange={e => { const u = users.find(u => u.id === e.target.value); if(u) setEditingLog({...editingLog, userId: u.id, userName: u.name}); }} > {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)} </select></div>
                         <div className="space-y-3"><label className="text-[10px] text-zinc-600 uppercase font-black tracking-[0.4em] ml-2 block">Workflow State</label><select className="w-full bg-black/50 border border-white/5 rounded-[24px] p-6 text-white text-base font-black outline-none focus:border-blue-600 transition-all shadow-inner" value={editingLog.operation} onChange={e => setEditingLog({...editingLog, operation: e.target.value})} > {ops.map(o => <option key={o} value={o}>{o}</option>)} </select></div>
                         <div className="grid grid-cols-2 gap-8">
                             <div className="space-y-3"><label className="text-[10px] text-zinc-600 uppercase font-black tracking-[0.4em] ml-2 block">Phase Start</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-xs font-black shadow-inner uppercase tracking-widest outline-none focus:border-blue-600" value={toDateTimeLocal(editingLog.startTime)} onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})} /></div>
                             <div className="space-y-3"><label className="text-[10px] text-zinc-600 uppercase font-black tracking-[0.4em] ml-2 block">Phase End</label><input type="datetime-local" className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-xs font-black shadow-inner uppercase tracking-widest outline-none focus:border-blue-600" value={toDateTimeLocal(editingLog.endTime)} onChange={e => setEditingLog({...editingLog, endTime: e.target.value ? new Date(e.target.value).getTime() : null})} /></div>
                         </div>
                     </div>
                     <div className="p-10 border-t border-white/5 bg-zinc-950/40 flex justify-between items-center">
                         <button onClick={() => { if(window.confirm("PURGE THIS LOG_ENTRY?")) { DB.deleteTimeLog(editingLog.id); setShowEditModal(false); addToast('success', 'RECORD_PURGED'); } }} className="text-red-500 hover:text-red-400 text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3"><Trash2 className="w-5 h-5"/> Terminate Record</button>
                         <div className="flex gap-4">
                             <button onClick={() => setShowEditModal(false)} className="text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all">Abort</button>
                             <button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-[20px] text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-blue-900/40">COMMIT</button>
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
     if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'DATA_NULL: PERSONNEL_DATA_MISSING');
     DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true });
     setShowModal(false);
     addToast('success', 'PERSONNEL_SYNCED');
   };

   return (
     <div className="space-y-10 animate-fade-in">
        <div className="flex justify-between items-center"><h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">Global Personnel</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-[24px] flex items-center gap-4 text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-blue-900/40 transition-all active:scale-95"><Plus className="w-5 h-5" /> Recruit Talent</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {users.map(u => (
            <div key={u.id} className="bg-zinc-900/40 border border-white/10 p-8 rounded-[40px] flex items-center justify-between shadow-2xl backdrop-blur-xl group hover:border-blue-500/30 transition-all">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-[24px] bg-zinc-800 flex items-center justify-center text-zinc-500 font-black border border-white/10 text-xl shadow-inner group-hover:text-blue-500 transition-colors uppercase">{u.name.charAt(0)}</div>
                <div><p className="font-black text-white text-xl tracking-tight leading-none mb-1.5 uppercase">{u.name}</p><p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.3em]">@{u.username} • {u.role}</p></div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => confirm({ title: "Revoke Credentials", message: "Permanently terminate system access?", onConfirm: () => DB.deleteUser(u.id) })} className="p-4 hover:bg-red-500/10 text-zinc-700 hover:text-red-500 transition-all rounded-2xl"><Trash2 className="w-5 h-5" /></button>
                 <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-4 hover:bg-white/5 text-zinc-600 hover:text-white transition-all rounded-2xl"><Edit2 className="w-5 h-5" /></button>
              </div>
            </div>
          ))}
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-3xl p-4 animate-fade-in">
             <div className="bg-zinc-900 border border-white/10 w-full max-w-md rounded-[56px] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.8)] overflow-hidden">
                <div className="p-10 border-b border-white/5 bg-zinc-950/40 uppercase font-black tracking-tighter leading-none"><h3 className="font-bold text-white text-xl uppercase tracking-tight">Identity Matrix</h3><p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-3">Staff Profile Control</p></div>
                <div className="p-10 space-y-6">
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] ml-2 block">Legal Name</label><input className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all uppercase tracking-tight" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] ml-2 block">Network Handle</label><input className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] ml-2 block">Access Cipher</label><input type="text" className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all tracking-[0.8em]" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] ml-2 block">System Rank</label><select className="w-full bg-black/50 border border-white/5 rounded-[24px] p-5 text-white text-sm font-black outline-none tracking-widest" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
                </div>
                <div className="p-10 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-5"><button onClick={() => setShowModal(false)} className="text-zinc-600 hover:text-white text-[10px] font-black uppercase tracking-[0.4em] transition-all">Abort</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-blue-900/40 transition-all active:scale-95">Sync Identity</button></div>
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
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'PROTOCOLS_UPDATED'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   const handleDeleteOp = (op: string) => { setSettings({...settings, customOperations: (settings.customOperations || []).filter(o => o !== op)}); };

   return (
     <div className="max-w-2xl space-y-12 animate-fade-in">
        <h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none">Core Protocols</h2>
        <div className="bg-zinc-900/40 border border-white/10 rounded-[56px] p-10 md:p-12 space-y-12 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-6 border-b border-white/10 pb-12"><div className="bg-blue-600/10 p-5 rounded-[32px] text-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)] border border-blue-500/20"><Activity className="w-10 h-10" /></div><div><h3 className="font-black text-white uppercase text-xl tracking-tight">Phase Definitions</h3><p className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-2">Workflow Structural Controls</p></div></div>
            <div className="space-y-8">
                <div className="flex gap-4">
                    <input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="Register new production phase..." className="flex-1 bg-black/50 border border-white/5 rounded-[24px] px-8 py-5 text-white text-sm font-black shadow-inner outline-none focus:border-blue-600 transition-all placeholder-zinc-800" onKeyDown={e => e.key === 'Enter' && handleAddOp()} />
                    <button onClick={handleAddOp} className="bg-blue-600 px-8 rounded-[24px] text-white font-black hover:bg-blue-500 transition-all active:scale-95 shadow-2xl shadow-blue-900/40"><Plus className="w-8 h-8" /></button>
                </div>
                <div className="flex flex-wrap gap-4">
                    {(settings.customOperations || []).map(op => (
                        <div key={op} className="bg-zinc-950 border border-white/5 px-6 py-4 rounded-[20px] flex items-center gap-5 group hover:border-blue-500/50 transition-all shadow-inner">
                            <span className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400 group-hover:text-white transition-colors">{op}</span>
                            <button onClick={() => handleDeleteOp(op)} className="text-zinc-800 hover:text-red-500 transition-colors"><X className="w-5 h-5" /></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-14 py-6 rounded-[32px] font-black uppercase tracking-[0.5em] shadow-[0_48px_128px_-32px_rgba(37,99,235,0.4)] flex items-center gap-4 transition-all active:scale-95 text-xs"><Save className="w-7 h-7" /> COMMENCE SYNC</button></div>
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

  useEffect(() => { 
    if(user) {
      localStorage.setItem('nexus_user', JSON.stringify(user)); 
      if(user.role === 'admin' && view === 'login') setView('admin-dashboard'); 
      else if(user.role === 'employee' && view === 'login') setView('employee-scan'); 
    } else {
      localStorage.removeItem('nexus_user'); setView('login');
    }
  }, [user]);

  const addToast = (t: any, m: any) => setToasts(p => [...p, {id: Date.now().toString(), type: t, message: m}]);

  if (!user || view === 'login') return <><PrintStyles /><LoginView onLogin={setUser} addToast={addToast} /><div className="fixed bottom-4 right-4 z-[9999] pointer-events-none w-full max-w-xs px-6"><div className="pointer-events-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div></>;

  const NavItem = ({ id, l, i: Icon }: any) => (
    <button 
      onClick={() => { setView(id); setIsMobileMenuOpen(false); }} 
      className={`flex items-center gap-5 w-full px-8 py-5 rounded-[24px] text-[11px] font-black uppercase tracking-[0.3em] transition-all group ${view === id ? 'bg-zinc-800 text-white shadow-[0_16px_32px_-8px_rgba(0,0,0,0.5)] border border-white/10 translate-x-2' : 'text-zinc-600 hover:text-white hover:bg-white/5'}`}
    >
      <Icon className={`w-6 h-6 transition-transform group-hover:scale-110 ${view === id ? 'text-blue-500 scale-110 shadow-blue-500/20' : ''}`} /> {l}
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col lg:flex-row font-sans overflow-x-hidden selection:bg-blue-600 selection:text-white">
       <PrintStyles />
       <PrintableJobSheet job={printable} onClose={() => setPrintable(null)} />
       <ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />

       {user.role === 'admin' && (
          <>
            <div className="lg:hidden bg-zinc-950/80 border-b border-white/5 p-6 flex justify-between items-center sticky top-0 z-40 backdrop-blur-3xl">
               <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shadow-2xl shadow-blue-500/20"><Sparkles className="w-6 h-6 text-white"/></div>
                 <span className="font-black uppercase tracking-tighter text-lg">SC DEBURRING</span>
               </div>
               <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-4 bg-zinc-900 border border-white/10 rounded-3xl text-white shadow-2xl transition-all active:scale-95">
                 {isMobileMenuOpen ? <X className="w-7 h-7"/> : <Menu className="w-7 h-7"/>}
               </button>
            </div>

            <aside className={`fixed lg:sticky top-0 inset-y-0 left-0 w-80 border-r border-white/5 bg-zinc-950 flex flex-col z-50 transform transition-transform duration-700 ease-in-out shadow-[24px_0_64px_rgba(0,0,0,0.5)] ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
               <div className="p-12 hidden lg:flex flex-col gap-1 border-b border-white/5 mb-10">
                 <div className="flex items-center gap-5">
                   <div className="w-14 h-14 rounded-[22px] bg-gradient-to-tr from-blue-600 to-indigo-700 flex items-center justify-center shadow-[0_0_30px_rgba(37,99,235,0.4)] border border-blue-500/20"><Sparkles className="w-8 h-8 text-white"/></div>
                   <h2 className="font-black text-2xl tracking-tighter text-white uppercase leading-none">SC DEBURRING</h2>
                 </div>
                 <p className="text-[10px] font-black text-zinc-700 uppercase tracking-[0.6em] mt-4 opacity-60">Operations Core_v3</p>
               </div>
               
               <nav className="flex-1 px-5 space-y-3.5 overflow-y-auto py-12 lg:py-0 custom-scrollbar">
                  <NavItem id="admin-dashboard" l="Floor Overview" i={LayoutDashboard} />
                  <NavItem id="admin-jobs" l="Production Batches" i={Briefcase} />
                  <NavItem id="admin-logs" l="Global Archive" i={Calendar} />
                  <NavItem id="admin-team" l="Human Resources" i={Users} />
                  <NavItem id="admin-settings" l="Core Protocols" i={Settings} />
                  <NavItem id="admin-scan" l="Floor Terminal" i={ScanLine} />
               </nav>

               <div className="p-8 border-t border-white/5 bg-zinc-900/30">
                 <button onClick={() => setUser(null)} className="w-full flex items-center gap-5 px-8 py-5 text-zinc-700 hover:text-red-500 text-[11px] font-black uppercase tracking-[0.4em] transition-all rounded-[24px] hover:bg-red-500/5 group">
                    <LogOut className="w-6 h-6 group-hover:scale-110 transition-all" /> Sign Out
                 </button>
               </div>
            </aside>
            {isMobileMenuOpen && <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}
          </>
       )}

       <main className={`flex-1 p-6 md:p-16 w-full max-w-full overflow-x-hidden ${user.role === 'admin' ? '' : 'min-h-screen bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-zinc-950 to-zinc-950'}`}>
          <div className="max-w-7xl mx-auto">
            {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} setView={setView} user={user} />}
            {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} />}
            {view === 'admin-logs' && <LogsView addToast={addToast} />}
            {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirm} />}
            {view === 'admin-settings' && <SettingsView addToast={addToast} />}
            {view === 'admin-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setView('admin-dashboard')} />}
            {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} />}
          </div>
       </main>

       <div className="fixed bottom-10 right-0 left-0 md:left-auto md:right-10 z-[9999] pointer-events-none px-8 md:px-0">
         <div className="pointer-events-auto flex flex-col items-end gap-4 max-w-md ml-auto">
            {toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}
         </div>
       </div>
    </div>
  );
}