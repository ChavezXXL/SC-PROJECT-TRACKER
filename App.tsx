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
    <div className="bg-zinc-900 border border-blue-500/30 rounded-2xl md:rounded-3xl p-4 md:p-8 shadow-2xl relative overflow-hidden animate-fade-in mb-6 md:mb-8 no-print">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-32 md:w-64 h-32 md:h-64 text-blue-500" /></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-50 animate-pulse"></div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 relative z-10">
        <div className="flex flex-col justify-center">
           <div className="flex items-center gap-2 mb-3 md:mb-4">
              <span className="animate-pulse w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></span>
              <span className="text-red-400 font-bold uppercase tracking-widest text-[10px] md:text-xs">Live Operation</span>
           </div>
           
           <h2 className="text-3xl md:text-6xl font-black text-white mb-2 break-all tracking-tighter">{job ? job.jobIdsDisplay : 'Unknown Job'}</h2>
           <div className="text-lg md:text-2xl text-blue-400 font-bold mb-6 md:mb-8 flex items-center gap-2">
             <span className="px-4 py-1 bg-blue-500/10 rounded-xl border border-blue-500/20">{log.operation}</span>
           </div>
           
           <div className="bg-black/40 rounded-2xl p-4 md:p-6 border border-white/10 mb-6 w-full max-w-sm flex items-center justify-between shadow-inner">
              <div>
                <p className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-widest mb-1">Duration</p>
                <div className="text-white text-3xl md:text-5xl font-black tracking-widest"><LiveTimer startTime={log.startTime} /></div>
              </div>
              <Clock className="w-6 md:w-10 h-6 md:h-10 text-zinc-700" />
           </div>

           <button 
             onClick={handleStopClick} 
             disabled={isStopping}
             className="w-full max-w-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 md:py-5 rounded-2xl font-black uppercase tracking-widest text-base md:text-lg flex items-center justify-center gap-3 shadow-lg shadow-red-900/40 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
           >
              {isStopping ? 'STOPPING...' : <><StopCircle className="w-6 h-6" /> END OPERATION</>}
           </button>
        </div>

        <div className="bg-white/5 rounded-2xl p-4 md:p-8 border border-white/5 flex flex-col h-full backdrop-blur-sm">
           <h3 className="text-zinc-500 font-black uppercase text-[10px] md:text-xs mb-6 flex items-center gap-2 tracking-[0.2em]">
             <Info className="w-4 h-4" /> Technical Data
           </h3>
           {job ? (
             <>
               <div className="grid grid-cols-2 gap-y-6 md:gap-y-8 gap-x-6">
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-widest">Part Number</label>
                    <div className="text-lg md:text-2xl font-black text-white mt-1 break-words leading-none">{job.partNumber}</div>
                  </div>
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-widest">PO Number</label>
                    <div className="text-lg md:text-2xl font-black text-white mt-1 break-words leading-none">{job.poNumber}</div>
                  </div>
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-widest">Target Qty</label>
                    <div className="text-lg md:text-2xl font-black text-white mt-1 leading-none">{job.quantity} <span className="text-xs font-bold text-zinc-500 ml-1">PCS</span></div>
                  </div>
                  <div>
                    <label className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-widest">Deadline</label>
                    <div className="text-lg md:text-2xl font-black text-red-500 mt-1 leading-none">{job.dueDate || 'N/A'}</div>
                  </div>
               </div>
               
               <div className="mt-auto pt-8 border-t border-white/10">
                 <label className="text-[10px] md:text-xs text-zinc-500 uppercase font-black tracking-widest mb-3 block">Instruction Manual</label>
                 <div className="text-zinc-300 text-xs md:text-sm leading-relaxed bg-black/30 p-4 rounded-xl border border-white/5 min-h-[80px] italic shadow-inner">
                   {job.info || "No special instructions provided for this operation."}
                 </div>
               </div>
             </>
           ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-8 text-center opacity-30">
               <AlertCircle className="w-12 h-12 mb-4" />
               <p className="font-bold">DATA UNAVAILABLE</p>
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
    <div className={`bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden transition-all duration-300 ${expanded ? 'ring-2 ring-blue-500/50 bg-zinc-800 shadow-2xl scale-[1.02]' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
      <div 
        className="p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-start mb-3 gap-3">
          <h3 className="text-lg font-black text-white truncate tracking-tight">{job.jobIdsDisplay}</h3>
          <span className="bg-zinc-950 text-blue-400 text-[10px] px-2 py-1 rounded font-black border border-blue-500/20 shrink-0">{job.quantity} PCS</span>
        </div>
        <div className="text-xs text-zinc-500 space-y-1.5 font-bold uppercase tracking-wider">
          <p className="truncate text-zinc-400">Part: <span className="text-white">{job.partNumber}</span></p>
          <p className="truncate">PO: <span className="text-zinc-300">{job.poNumber}</span></p>
        </div>
        
        {!expanded && (
          <div className="mt-5 flex items-center text-blue-500 text-[10px] font-black uppercase tracking-widest border-t border-white/5 pt-4">
            START OPERATION <ArrowRight className="w-3 h-3 ml-auto animate-pulse" />
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-4 bg-zinc-950/40 border-t border-white/5 animate-fade-in">
          <p className="text-[10px] text-zinc-500 uppercase font-black mb-3 tracking-widest">Select Process:</p>
          <div className="grid grid-cols-2 gap-2">
            {operations.map(op => (
              <button
                key={op}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(job.id, op);
                }}
                className="bg-zinc-900 hover:bg-blue-600 hover:text-white border border-white/5 py-3 px-2 rounded-xl text-xs font-black uppercase tracking-tighter transition-all active:scale-95 text-zinc-300"
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
    <div className="space-y-6 max-w-5xl mx-auto pb-20">
      {activeLog && <ActiveJobPanel job={activeJob} log={activeLog} onStop={DB.stopTimeLog} />}

      <div className="flex justify-between items-center bg-zinc-900/50 backdrop-blur-xl p-2 rounded-3xl border border-white/10 sticky top-4 z-30 shadow-2xl">
         <div className="flex gap-1">
           <button onClick={() => setTab('jobs')} className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${tab === 'jobs' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}>Jobs</button>
           <button onClick={() => setTab('history')} className={`px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${tab === 'history' ? 'bg-blue-600 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}>History</button>
         </div>
         <div className="flex gap-2">
             <button onClick={() => setTab('scan')} className={`p-2.5 rounded-2xl transition-all ${tab === 'scan' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-blue-500'}`}><ScanLine className="w-5 h-5" /></button>
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 p-2.5 rounded-2xl hover:bg-red-600 hover:text-white transition-all"><LogOut className="w-5 h-5" /></button>
         </div>
      </div>

      {tab === 'scan' ? (
         <div className="py-12 animate-fade-in flex justify-center">
            <div className="bg-zinc-900 p-10 rounded-[40px] border border-white/10 text-center max-w-sm w-full shadow-2xl">
               <div className="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mx-auto mb-6"><QrCode className="w-10 h-10 text-blue-500" /></div>
               <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-tight">Scanner Ready</h2>
               <p className="text-zinc-500 text-xs font-bold mb-6 tracking-widest uppercase opacity-60">Focus on traveler QR</p>
               <input autoFocus onKeyDown={(e) => { if(e.key === 'Enter') { setSearch(e.currentTarget.value); setTab('jobs'); e.currentTarget.value = ''; } }} className="bg-black/50 border-2 border-blue-500/50 rounded-2xl px-6 py-4 text-white text-center w-full text-lg font-black focus:ring-4 focus:ring-blue-500/20 outline-none" placeholder="WAITING FOR SCAN..." />
            </div>
         </div>
      ) : tab === 'history' ? (
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
           <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-zinc-500 font-black uppercase tracking-widest text-[10px]"><tr><th className="p-5">Date</th><th className="p-5">Job ID</th><th className="p-5">Op</th><th className="p-5">Time</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {myHistory.map(log => (
                  <tr key={log.id} className="hover:bg-white/5 transition-colors">
                    <td className="p-5 text-zinc-400 font-bold">{new Date(log.startTime).toLocaleDateString()}</td>
                    <td className="p-5 text-white font-black">{log.jobId}</td>
                    <td className="p-5 text-zinc-300 font-bold">{log.operation}</td>
                    <td className="p-5 text-blue-400 font-black font-mono">{formatDuration(log.durationMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
           </div>
        </div>
      ) : (
        <div className="animate-fade-in space-y-6">
          <div className="relative">
            <Search className="absolute left-5 top-4.5 w-5 h-5 text-zinc-600" />
            <input type="text" placeholder="FILTER ACTIVE PRODUCTION..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/5 rounded-3xl pl-14 pr-6 py-4 text-white font-black uppercase tracking-widest text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-xl"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredJobs.map(job => <JobSelectionCard key={job.id} job={job} onStart={DB.startTimeLog} disabled={!!activeLog} operations={ops} />)}
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[32px] p-8 shadow-2xl text-center">
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6"><AlertTriangle className="text-red-500 w-8 h-8" /></div>
        <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">{title}</h3>
        <p className="text-zinc-500 text-sm font-bold mb-8 leading-relaxed">{message}</p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onCancel} className="bg-zinc-800 text-zinc-400 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:text-white transition-all">Cancel</button>
          <button onClick={() => { onConfirm(); onCancel(); }} className="bg-red-600 text-white py-3 rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-red-900/20 hover:bg-red-500 transition-all">Confirm</button>
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 animate-fade-in overflow-y-auto no-print-background">
      <div className="bg-white text-black w-full max-w-4xl rounded-[32px] shadow-2xl relative flex flex-col min-h-[90vh] md:min-h-0" id="printable-area-root">
         
         <div className="bg-zinc-950 text-white p-5 flex justify-between items-center no-print shrink-0 border-b border-white/10 rounded-t-[32px]">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg"><Printer className="w-5 h-5" /></div>
               <div><h3 className="font-black text-sm uppercase tracking-tighter">Document Preview</h3><p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Ready for output</p></div>
             </div>
             <div className="flex gap-2">
                 <button onClick={onClose} className="px-5 py-2 text-zinc-400 hover:text-white text-[10px] font-black uppercase tracking-widest">Close</button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all"><Printer className="w-4 h-4"/> PRINT TRAVELER</button>
             </div>
         </div>

         <div className="flex-1 p-10 md:p-16 bg-white flex flex-col text-black">
            <div className="flex justify-between items-start border-b-[8px] border-black pb-8 mb-10">
              <div>
                 <h1 className="text-6xl font-black tracking-tighter leading-none mb-4">SC DEBURRING</h1>
                 <p className="text-sm font-black uppercase tracking-[0.4em] bg-black text-white px-3 py-1.5 w-fit">Production Traveler</p>
              </div>
              <div className="text-right">
                 <div className="text-3xl font-black">{new Date().toLocaleDateString()}</div>
                 <div className="text-[10px] uppercase font-black text-gray-400 mt-2 tracking-widest">Master Production File</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 flex-1">
               <div className="space-y-8">
                   <div className="border-[6px] border-black p-8 bg-gray-50 shadow-[8px_8px_0px_rgba(0,0,0,0.1)]">
                      <label className="block text-[10px] uppercase font-black text-gray-500 mb-2 tracking-[0.2em]">Purchase Order #</label>
                      <div className="text-5xl md:text-7xl font-black leading-none break-all tracking-tighter">{job.poNumber}</div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-6">
                      <div className="border-4 border-gray-100 p-5"><label className="block text-[9px] uppercase font-black text-gray-400 mb-1">Part Number</label><div className="text-2xl font-black truncate">{job.partNumber}</div></div>
                      <div className="border-4 border-gray-100 p-5"><label className="block text-[9px] uppercase font-black text-gray-400 mb-1">Quantity</label><div className="text-3xl font-black">{job.quantity}</div></div>
                      <div className="border-4 border-gray-100 p-5"><label className="block text-[9px] uppercase font-black text-gray-400 mb-1">Received</label><div className="text-xl font-bold">{job.dateReceived || '-'}</div></div>
                      <div className="border-4 border-red-100 p-5"><label className="block text-[9px] uppercase font-black text-red-500 mb-1">DUE DATE</label><div className="text-2xl font-black text-red-600 underline underline-offset-4 decoration-2">{job.dueDate || 'ASAP'}</div></div>
                   </div>

                   <div className="border-t-4 border-black pt-8">
                     <label className="block text-[10px] uppercase font-black text-gray-500 mb-4 tracking-[0.2em]">Production Instructions</label>
                     <div className="text-xl leading-relaxed p-8 bg-gray-50 min-h-[200px] border-2 border-dashed border-gray-200 font-medium">
                       {job.info || "Proceed with standard deburring process. Verify counts upon completion."}
                     </div>
                   </div>
               </div>
               
               <div className="flex flex-col items-center justify-center border-[12px] border-black p-10 bg-white h-full relative">
                  <div className="w-full aspect-square flex items-center justify-center">
                    <img src={qrUrl} alt="QR" className="w-full h-full object-contain" crossOrigin="anonymous" />
                  </div>
                  <div className="mt-10 text-center space-y-3 w-full">
                    <p className="font-mono text-2xl font-black tracking-tighter text-gray-300 break-all border-b-2 border-gray-100 pb-4">{job.id}</p>
                    <p className="font-black uppercase tracking-[0.5em] text-3xl md:text-4xl pt-4">TRACK ID</p>
                    <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mt-4">SC DEBURRING OPERATIONAL SYSTEMS</p>
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
    if (user) { onLogin(user); addToast('success', `ACCESS GRANTED: ${user.name}`); }
    else { addToast('error', 'DENIED: INVALID CREDENTIALS'); setPin(''); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent"></div>
      <div className="w-full max-w-sm bg-zinc-900/40 backdrop-blur-3xl border border-white/10 p-10 rounded-[48px] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] relative z-10">
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-pulse">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-black text-center text-white tracking-tighter mb-1 uppercase">SC DEBURRING</h1>
        <p className="text-center text-zinc-500 text-[10px] uppercase font-black tracking-[0.3em] mb-10 opacity-60">Operations Network</p>
        
        <form onSubmit={handleLogin} className="space-y-5">
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white font-bold tracking-wide focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-zinc-700" placeholder="USERNAME" autoFocus />
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border border-white/5 rounded-2xl px-5 py-4 text-white font-bold tracking-widest focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder-zinc-700" placeholder="••••" />
          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4.5 rounded-2xl font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-blue-900/40 mt-4 disabled:opacity-50 active:scale-95">
            {loading ? 'VERIFYING...' : 'SIGN IN'}
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
      <div className="space-y-8 animate-fade-in">
         {activeLogs.find(l => l.userId === user.id) && (
            <ActiveJobPanel 
              job={jobs.find(j => j.id === activeLogs.find(l => l.userId === user.id)?.jobId) || null} 
              log={activeLogs.find(l => l.userId === user.id)!} 
              onStop={DB.stopTimeLog} 
            />
         )}

         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: 'Active Floor', val: new Set(activeLogs.map(l => l.jobId)).size, sub: 'LIVE JOBS', icon: Activity, color: 'text-blue-500' },
              { label: 'Production WIP', val: jobs.filter(j => j.status === 'in-progress').length, sub: 'TOTAL OPEN', icon: Briefcase, color: 'text-zinc-400' },
              { label: 'Floor Staff', val: new Set(activeLogs.map(l => l.userId)).size, sub: 'CLOCKED IN', icon: Users, color: 'text-emerald-500' }
            ].map((s, i) => (
              <div key={i} className="bg-zinc-900/40 border border-white/10 p-8 rounded-[32px] flex justify-between items-center shadow-xl backdrop-blur-md">
                 <div>
                     <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{s.label}</p>
                     <h3 className="text-4xl font-black text-white tracking-tighter leading-none">{s.val}</h3>
                     <p className={`text-[9px] uppercase font-black mt-2 tracking-widest ${s.color}`}>{s.sub}</p>
                 </div>
                 <s.icon className={`w-10 h-10 ${s.color} ${s.label === 'Active Floor' && s.val > 0 ? 'animate-pulse' : 'opacity-20'}`} />
              </div>
            ))}
         </div>
         
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             <div className="bg-zinc-900/40 border border-white/10 rounded-[32px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-md">
                <div className="p-6 md:p-8 border-b border-white/10 flex items-center justify-between"><h3 className="font-black text-white uppercase tracking-tight flex items-center gap-3"><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> Live Operations</h3></div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">
                   {activeLogs.length === 0 && <div className="p-16 text-center text-zinc-600 text-xs font-black uppercase tracking-widest opacity-40">Floor idle. no active timers.</div>}
                   {activeLogs.map(l => (
                      <div key={l.id} className="p-6 flex items-center justify-between hover:bg-white/5 transition-all">
                         <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center font-black text-zinc-400 border border-white/10 text-sm shadow-inner">{l.userName.charAt(0)}</div>
                            <div>
                                <p className="font-black text-white text-base tracking-tight leading-none mb-1">{l.userName}</p>
                                <p className="text-[10px] text-blue-500 font-black uppercase tracking-widest">{l.operation}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-5">
                            <div className="text-white text-xl md:text-2xl font-black font-mono tracking-widest"><LiveTimer startTime={l.startTime} /></div>
                            <button onClick={() => confirmAction({ title: "Force Termination", message: "Stop this operator's timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-3 rounded-2xl hover:bg-red-600 hover:text-white transition-all shadow-lg shadow-red-900/20"><Power className="w-5 h-5" /></button>
                         </div>
                      </div>
                   ))}
                </div>
             </div>

             <div className="bg-zinc-900/40 border border-white/10 rounded-[32px] overflow-hidden flex flex-col h-full shadow-2xl backdrop-blur-md">
                <div className="p-6 md:p-8 border-b border-white/10 flex justify-between items-center">
                    <h3 className="font-black text-white uppercase tracking-tight flex items-center gap-3"><History className="w-5 h-5 text-blue-500"/> Activity Stream</h3>
                    <button onClick={() => setView('admin-logs')} className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-white transition-colors">View Logs</button>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">
                   {logs.length === 0 && <div className="p-16 text-center text-zinc-600 text-xs font-black uppercase tracking-widest opacity-40">No historical data available</div>}
                   {logs.map(l => (
                       <div key={l.id} className="p-6 flex items-start gap-4 hover:bg-white/5 transition-all">
                           <div className={`mt-2 w-2 h-2 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-600' : 'bg-emerald-500 animate-pulse'}`}></div>
                           <div className="flex-1">
                               <p className="text-sm text-white font-bold leading-tight">
                                   <span className="font-black text-blue-400 mr-1">{l.userName}</span> {l.endTime ? 'completed' : 'initiated'} <span className="text-zinc-300">{l.operation}</span>
                               </p>
                               <p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mt-1">Batch: {l.jobId} • {new Date(l.startTime).toLocaleTimeString()}</p>
                           </div>
                           {l.durationMinutes && <div className="text-[11px] font-black font-mono text-zinc-400 bg-zinc-800 px-3 py-1.5 rounded-xl border border-white/5 shadow-inner">{formatDuration(l.durationMinutes)}</div>}
                       </div>
                   ))}
                </div>
             </div>
         </div>
      </div>
   );
};

// --- ADMIN: JOBS ---
const JobsView = ({ user, addToast, setPrintable, confirm }: any) => {
   const [jobs, setJobs] = useState<Job[]>([]);
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

   const activeJobs = useMemo(() => {
       const term = search.toLowerCase();
       return jobs.filter(j => j.status !== 'completed' && JSON.stringify(j).toLowerCase().includes(term)).sort((a,b) => b.createdAt - a.createdAt);
   }, [jobs, search]);

   const handleSave = async () => {
    if (!editingJob.jobIdsDisplay || !editingJob.partNumber) return addToast('error', 'FIELDS REQUIRED');
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
    addToast('success', 'PRODUCTION RECORD UPDATED');
    setShowModal(false);
    setIsSaving(false);
   };

   return (
      <div className="space-y-6 animate-fade-in">
         <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6">
            <h2 className="text-3xl font-black flex items-center gap-3 uppercase tracking-tighter text-white leading-none">Production Floor</h2>
            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 lg:flex-initial shadow-2xl">
                    <Search className="absolute left-4 top-3 w-4 h-4 text-zinc-600" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter PO, Job, Part..." className="pl-11 pr-5 py-3 bg-zinc-900/60 border border-white/10 rounded-[20px] text-xs font-black uppercase tracking-widest text-white w-full lg:w-72 focus:ring-4 focus:ring-blue-500/10 outline-none backdrop-blur-md" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-6 py-3 rounded-[20px] text-xs font-black uppercase tracking-widest text-white flex items-center gap-2 hover:bg-blue-500 shadow-xl shadow-blue-900/40 transition-all active:scale-95"><Plus className="w-4 h-4"/> New Job</button>
            </div>
         </div>
         
         <div className="bg-zinc-900/40 border border-white/10 rounded-[40px] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-950/80 text-zinc-600 font-black uppercase tracking-[0.2em] text-[10px]">
                        <tr>
                            <th className="p-6">Purchase Order</th>
                            <th className="p-6">Job ID</th>
                            <th className="p-6">Part #</th>
                            <th className="p-6">Quantity</th>
                            <th className="p-6">Status</th>
                            <th className="p-6 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {activeJobs.map(j => (
                           <tr key={j.id} className="hover:bg-white/[0.03] transition-colors group">
                              <td className="p-6 text-white font-black text-lg tracking-tighter leading-none break-all max-w-[200px]">{j.poNumber}</td>
                              <td className="p-6 text-zinc-400 font-mono font-bold text-sm tracking-tighter">{j.jobIdsDisplay}</td>
                              <td className="p-6 text-zinc-400 font-bold uppercase tracking-widest text-xs truncate max-w-[150px]">{j.partNumber}</td>
                              <td className="p-6 text-blue-500 font-black font-mono text-lg leading-none">{j.quantity}</td>
                              <td className="p-6">
                                  <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex w-fit items-center gap-2 border shadow-lg ${j.status === 'in-progress' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-zinc-800 text-zinc-500 border-white/5'}`}>
                                      {j.status === 'in-progress' && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_#3b82f6]"/>}
                                      {j.status}
                                  </span>
                              </td>
                              <td className="p-6 text-right">
                                 <div className="flex justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => confirm({ title: "Complete Batch", message: "Archive this production run?", onConfirm: () => DB.completeJob(j.id) })} className="p-3 bg-emerald-500/10 text-emerald-500 rounded-2xl hover:bg-emerald-500 hover:text-white transition-all shadow-lg" title="Done"><CheckCircle className="w-4 h-4"/></button>
                                    <button onClick={() => setPrintable(j)} className="p-3 bg-zinc-800 text-zinc-400 rounded-2xl hover:bg-zinc-700 hover:text-white transition-all shadow-lg" title="Traveler"><Printer className="w-4 h-4"/></button>
                                    <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl hover:bg-blue-500 hover:text-white transition-all shadow-lg" title="Edit"><Edit2 className="w-4 h-4"/></button>
                                    <button onClick={() => confirm({ title: "Destroy Record", message: "Permanently delete this production file?", onConfirm: () => DB.deleteJob(j.id) })} className="p-3 bg-red-500/10 text-red-400 rounded-2xl hover:bg-red-600 hover:text-white transition-all shadow-lg" title="Delete"><Trash2 className="w-4 h-4"/></button>
                                 </div>
                              </td>
                           </tr>
                        ))}
                        {activeJobs.length === 0 && <tr><td colSpan={6} className="p-24 text-center text-zinc-700 text-sm font-black uppercase tracking-[0.5em] opacity-40">No production active</td></tr>}
                    </tbody>
                </table>
            </div>
         </div>

         {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-[48px] shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-8 border-b border-white/5 flex justify-between items-center bg-zinc-950/40">
              <div><h3 className="font-black text-white uppercase text-lg tracking-tight">Technical Spec</h3><p className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mt-1">Production File #{editingJob.id || 'NEW'}</p></div>
              <button onClick={() => setShowModal(false)} className="p-3 bg-white/5 rounded-2xl text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-1.5">
                <label className="text-[10px] text-blue-500 font-black uppercase tracking-[0.2em] ml-1">Purchase Order Number</label>
                <input className="w-full bg-black/40 border-2 border-white/10 rounded-2xl p-4 text-white text-xl font-black focus:border-blue-600 outline-none transition-all shadow-inner" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1">Job Sequence</label><input className="w-full bg-black/30 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white shadow-inner" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1">Catalog Part #</label><input className="w-full bg-black/30 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white shadow-inner" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1">Item Count</label><input type="number" className="w-full bg-black/30 border border-white/5 rounded-2xl p-3 text-sm font-bold text-white shadow-inner" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1">Due Date</label><input type="date" className="w-full bg-zinc-800 border border-white/5 rounded-2xl p-3 text-xs font-bold text-white shadow-inner" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
              </div>
              <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1">Notes & Logic</label><textarea className="w-full bg-black/30 border border-white/5 rounded-2xl p-4 text-xs font-bold text-white shadow-inner" rows={3} value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
            </div>
            <div className="p-8 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-6 py-3 text-zinc-500 hover:text-white text-xs font-black uppercase tracking-[0.2em] transition-colors">Discard</button>
              <button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-[20px] text-xs font-black uppercase tracking-[0.3em] disabled:opacity-50 shadow-xl shadow-blue-900/40 active:scale-95 transition-all">{isSaving ? 'SYNCING...' : 'COMMIT DATA'}</button>
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
       if (editingLog.endTime && editingLog.endTime < editingLog.startTime) return addToast('error', 'DATE CONFLICT');
       await DB.updateTimeLog(editingLog);
       addToast('success', 'RECORD VALIDATED');
       setShowEditModal(false);
   };

   return (
      <div className="space-y-8 animate-fade-in">
         <div className="flex justify-between items-center">
             <h2 className="text-3xl font-black flex items-center gap-4 uppercase tracking-tighter text-white">System Archive</h2>
             <button onClick={() => setRefreshKey(k => k + 1)} className="p-3 bg-zinc-900/60 border border-white/10 rounded-2xl text-zinc-500 hover:text-white transition-all shadow-xl backdrop-blur-md" title="Reload System State"><RefreshCw className="w-5 h-5" /></button>
         </div>

         <div className="bg-zinc-900/40 border border-white/10 rounded-[40px] overflow-hidden shadow-2xl backdrop-blur-xl">
             <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-zinc-950/80 text-zinc-600 font-black uppercase tracking-[0.2em] text-[10px]"><tr><th className="p-6">Event Date</th><th className="p-6">Start Time</th><th className="p-6">End Time</th><th className="p-6">Operator</th><th className="p-6">Phase</th><th className="p-6 text-right">Edit</th></tr></thead>
                    <tbody className="divide-y divide-white/5">
                    {logs.map(l => (
                        <tr key={l.id} className="hover:bg-white/[0.03] transition-colors">
                            <td className="p-6 text-zinc-400 font-black text-sm whitespace-nowrap uppercase">{new Date(l.startTime).toLocaleDateString()}</td>
                            <td className="p-6 font-mono text-zinc-300 whitespace-nowrap text-sm">{new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                            <td className="p-6 font-mono text-zinc-300 whitespace-nowrap text-sm">{l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : <span className="text-emerald-500 font-black tracking-widest text-[9px] animate-pulse bg-emerald-500/10 px-2 py-1 rounded-lg">LIVE NOW</span>}</td>
                            <td className="p-6 text-white font-black uppercase tracking-tight text-base truncate max-w-[120px] leading-none">{l.userName}</td>
                            <td className="p-6 text-blue-500 font-black uppercase tracking-widest text-[10px]">{l.operation}</td>
                            <td className="p-6 text-right">
                                <button onClick={() => { setEditingLog({...l}); setShowEditModal(true); }} className="p-3 bg-zinc-800/50 rounded-2xl text-zinc-500 hover:text-white transition-all shadow-lg"><Edit2 className="w-4 h-4"/></button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
             </div>
         </div>

         {showEditModal && editingLog && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 animate-fade-in">
                 <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-[48px] shadow-2xl overflow-hidden">
                     <div className="p-8 border-b border-white/5 flex justify-between items-center bg-zinc-950/40 uppercase font-black tracking-tighter">
                         <h3 className="font-bold text-white flex items-center gap-3"><Edit2 className="w-5 h-5 text-blue-500" /> Adjust Log Entry</h3>
                         <button onClick={() => setShowEditModal(false)} className="p-3 bg-white/5 rounded-2xl text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
                     </div>
                     <div className="p-8 space-y-6">
                         <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em] ml-1">Staff Selection</label><select className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold outline-none" value={editingLog.userId} onChange={e => { const u = users.find(u => u.id === e.target.value); if(u) setEditingLog({...editingLog, userId: u.id, userName: u.name}); }} > {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)} </select></div>
                         <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em] ml-1">Process Phase</label><select className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold outline-none" value={editingLog.operation} onChange={e => setEditingLog({...editingLog, operation: e.target.value})} > {ops.map(o => <option key={o} value={o}>{o}</option>)} </select></div>
                         <div className="grid grid-cols-2 gap-6">
                             <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em] ml-1">Initiated</label><input type="datetime-local" className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-white text-xs font-bold shadow-inner" value={toDateTimeLocal(editingLog.startTime)} onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})} /></div>
                             <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em] ml-1">Terminated</label><input type="datetime-local" className="w-full bg-black/40 border border-white/5 rounded-2xl p-3 text-white text-xs font-bold shadow-inner" value={toDateTimeLocal(editingLog.endTime)} onChange={e => setEditingLog({...editingLog, endTime: e.target.value ? new Date(e.target.value).getTime() : null})} /></div>
                         </div>
                     </div>
                     <div className="p-8 border-t border-white/5 bg-zinc-950/40 flex justify-between items-center">
                         <button onClick={() => { if(window.confirm("PURGE THIS LOG?")) { DB.deleteTimeLog(editingLog.id); setShowEditModal(false); addToast('success', 'RECORD PURGED'); } }} className="text-red-500 hover:text-red-400 text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2"><Trash2 className="w-4 h-4"/> Delete</button>
                         <div className="flex gap-3">
                             <button onClick={() => setShowEditModal(false)} className="text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-widest">Abort</button>
                             <button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] shadow-xl shadow-blue-900/40">COMMIT</button>
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
     if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'FIELDS REQUIRED');
     DB.saveUser({ id: editingUser.id || Date.now().toString(), name: editingUser.name, username: editingUser.username, pin: editingUser.pin, role: editingUser.role || 'employee', isActive: true });
     setShowModal(false);
     addToast('success', 'PROFILE SYNCED');
   };

   return (
     <div className="space-y-8 animate-fade-in">
        <div className="flex justify-between items-center"><h2 className="text-3xl font-black uppercase tracking-tighter text-white">Personnel</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-[20px] flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-900/40"><Plus className="w-4 h-4" /> Recruit</button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {users.map(u => (
            <div key={u.id} className="bg-zinc-900/40 border border-white/10 p-6 rounded-[32px] flex items-center justify-between shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-400 font-black border border-white/10 text-lg shadow-inner">{u.name.charAt(0)}</div>
                <div><p className="font-black text-white text-lg tracking-tight leading-none mb-1">{u.name}</p><p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">@{u.username} • {u.role}</p></div>
              </div>
              <div className="flex gap-1">
                 <button onClick={() => confirm({ title: "Remove Access", message: "Permanently revoke system access?", onConfirm: () => DB.deleteUser(u.id) })} className="p-3 hover:bg-red-500/10 text-zinc-600 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                 <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-3 hover:bg-white/5 text-zinc-500 hover:text-white transition-colors"><Edit2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4">
             <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-[48px] shadow-2xl overflow-hidden">
                <div className="p-8 border-b border-white/5 bg-zinc-950/40 uppercase font-black tracking-tighter"><h3 className="font-bold text-white">Identity Matrix</h3><button onClick={() => setShowModal(false)} className="p-3 bg-white/5 rounded-2xl text-zinc-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button></div>
                <div className="p-8 space-y-5">
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Legal Name</label><input className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">System Handle</label><input className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">Access Code</label><input type="text" className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all tracking-[0.5em]" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] ml-1 block">System Privilege</label><select className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-white text-sm font-bold outline-none" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
                </div>
                <div className="p-8 border-t border-white/5 bg-zinc-950/40 flex justify-end gap-3"><button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-white text-[10px] font-black uppercase tracking-widest">Abort</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-10 py-4 rounded-[20px] text-[10px] font-black uppercase tracking-[0.3em] shadow-xl shadow-blue-900/40 transition-all active:scale-95">Save Profile</button></div>
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
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'PROTOCOL UPDATED'); };
   const handleAddOp = () => { if(!newOp.trim()) return; setSettings({...settings, customOperations: [...(settings.customOperations || []), newOp.trim()]}); setNewOp(''); };
   const handleDeleteOp = (op: string) => { setSettings({...settings, customOperations: (settings.customOperations || []).filter(o => o !== op)}); };

   return (
     <div className="max-w-2xl space-y-10 animate-fade-in">
        <h2 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">System Protocols</h2>
        <div className="bg-zinc-900/40 border border-white/10 rounded-[48px] p-8 md:p-10 space-y-10 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-5 border-b border-white/10 pb-10"><div className="bg-blue-500/10 p-4 rounded-3xl text-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]"><Activity className="w-8 h-8" /></div><div><h3 className="font-black text-white uppercase text-lg tracking-tight">Workflow Phases</h3><p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.3em] mt-1">Operational Sequence Controls</p></div></div>
            <div className="space-y-6">
                <div className="flex gap-3">
                    <input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="Register new operation phase..." className="flex-1 bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-white text-sm font-bold shadow-inner outline-none focus:border-blue-600 transition-all placeholder-zinc-700" onKeyDown={e => e.key === 'Enter' && handleAddOp()} />
                    <button onClick={handleAddOp} className="bg-blue-600 px-6 rounded-2xl text-white font-black hover:bg-blue-500 transition-all active:scale-95 shadow-xl shadow-blue-900/40"><Plus className="w-6 h-6" /></button>
                </div>
                <div className="flex flex-wrap gap-3">
                    {(settings.customOperations || []).map(op => (
                        <div key={op} className="bg-zinc-950 border border-white/5 px-5 py-3 rounded-2xl flex items-center gap-4 group hover:border-blue-500/50 transition-colors shadow-inner">
                            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-300">{op}</span>
                            <button onClick={() => handleDeleteOp(op)} className="text-zinc-600 hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-12 py-5 rounded-[24px] font-black uppercase tracking-[0.4em] shadow-2xl shadow-blue-900/50 flex items-center gap-3 transition-all active:scale-95"><Save className="w-6 h-6" /> Save Protocols</button></div>
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

  if (!user || view === 'login') return <><PrintStyles /><LoginView onLogin={setUser} addToast={addToast} /><div className="fixed bottom-4 right-4 z-[9999] pointer-events-none w-full max-w-xs px-4"><div className="pointer-events-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div></>;

  const NavItem = ({ id, l, i: Icon }: any) => (
    <button 
      onClick={() => { setView(id); setIsMobileMenuOpen(false); }} 
      className={`flex items-center gap-4 w-full px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all ${view === id ? 'bg-zinc-800 text-white shadow-xl border border-white/10 translate-x-1' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
    >
      <Icon className={`w-5 h-5 ${view === id ? 'text-blue-500' : ''}`} /> {l}
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col lg:flex-row font-sans overflow-x-hidden selection:bg-blue-500 selection:text-white">
       <PrintStyles />
       <PrintableJobSheet job={printable} onClose={() => setPrintable(null)} />
       <ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />

       {user.role === 'admin' && (
          <>
            <div className="lg:hidden bg-zinc-950 border-b border-white/5 p-5 flex justify-between items-center sticky top-0 z-40 backdrop-blur-xl">
               <div className="flex items-center gap-3">
                 <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg"><Sparkles className="w-5 h-5 text-white"/></div>
                 <span className="font-black uppercase tracking-tighter text-base">SC DEBURRING</span>
               </div>
               <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-3 bg-zinc-900 border border-white/10 rounded-2xl text-white shadow-xl">
                 {isMobileMenuOpen ? <X className="w-6 h-6"/> : <Menu className="w-6 h-6"/>}
               </button>
            </div>

            <aside className={`fixed lg:sticky top-0 inset-y-0 left-0 w-72 border-r border-white/5 bg-zinc-950 flex flex-col z-50 transform transition-transform duration-500 ease-in-out shadow-[10px_0_40px_rgba(0,0,0,0.4)] ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
               <div className="p-10 hidden lg:flex flex-col gap-1 border-b border-white/5 mb-8">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 rounded-[18px] bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]"><Sparkles className="w-6 h-6 text-white"/></div>
                   <h2 className="font-black text-xl tracking-tighter text-white uppercase leading-none">SC DEBURRING</h2>
                 </div>
                 <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.4em] mt-3 opacity-60">System Core 3.0</p>
               </div>
               
               <nav className="flex-1 px-4 space-y-2.5 overflow-y-auto py-8 lg:py-0">
                  <NavItem id="admin-dashboard" l="Floor Overview" i={LayoutDashboard} />
                  <NavItem id="admin-jobs" l="Production Batches" i={Briefcase} />
                  <NavItem id="admin-logs" l="Archive Logs" i={Calendar} />
                  <NavItem id="admin-team" l="Personnel" i={Users} />
                  <NavItem id="admin-settings" l="Core Protocols" i={Settings} />
                  <NavItem id="admin-scan" l="Operator Terminal" i={ScanLine} />
               </nav>

               <div className="p-6 border-t border-white/5 bg-zinc-900/30">
                 <button onClick={() => setUser(null)} className="w-full flex items-center gap-4 px-6 py-4 text-zinc-500 hover:text-red-500 text-[10px] font-black uppercase tracking-[0.3em] transition-all rounded-2xl hover:bg-red-500/5 group">
                    <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" /> Sign Out
                 </button>
               </div>
            </aside>
            {isMobileMenuOpen && <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}
          </>
       )}

       <main className={`flex-1 p-4 md:p-12 w-full max-w-full overflow-x-hidden ${user.role === 'admin' ? '' : 'min-h-screen bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-zinc-950 to-zinc-950'}`}>
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

       <div className="fixed bottom-8 right-0 left-0 md:left-auto md:right-8 z-[9999] pointer-events-none px-6 md:px-0">
         <div className="pointer-events-auto flex flex-col items-end gap-3 max-w-sm ml-auto">
            {toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}
         </div>
       </div>
    </div>
  );
}