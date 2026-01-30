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
        visibility: hidden;
      }
      #printable-modal, #printable-modal * {
        visibility: visible;
      }
      #printable-modal {
        position: absolute;
        left: 0;
        top: 0;
        width: 100%;
        min-height: 100%;
        margin: 0;
        padding: 0;
        background: white;
        z-index: 9999;
      }
      .no-print {
        display: none !important;
      }
      @page {
        size: auto;
        margin: 5mm;
      }
      .print-break-inside-avoid {
        page-break-inside: avoid;
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
    <div className="font-mono text-4xl md:text-5xl font-bold tracking-widest tabular-nums">
      {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}:{s.toString().padStart(2, '0')}
    </div>
  );
};

// --- COMPONENT: ACTIVE JOB PANEL (Non-blocking) ---
const ActiveJobPanel = ({ job, log, onStop }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void> }) => {
  const [isStopping, setIsStopping] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  const handleStopClick = async () => {
    if (isStopping) return;
    setIsStopping(true);
    try {
        await onStop(log.id);
    } catch (e) {
        if (isMounted.current) {
            setIsStopping(false);
        }
    }
  };

  return (
    <div className="bg-zinc-900 border border-blue-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-50 animate-pulse"></div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        <div className="flex flex-col justify-center">
           <div className="flex items-center gap-2 mb-4">
              <span className="animate-pulse w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></span>
              <span className="text-red-400 font-bold uppercase tracking-widest text-xs">Job In Progress</span>
           </div>
           
           <h2 className="text-4xl md:text-5xl font-black text-white mb-2">{job ? job.jobIdsDisplay : 'Unknown Job'}</h2>
           <div className="text-xl text-blue-400 font-medium mb-8 flex items-center gap-2">
             <span className="px-3 py-1 bg-blue-500/10 rounded-lg border border-blue-500/20">{log.operation}</span>
           </div>
           
           <div className="bg-black/40 rounded-2xl p-6 border border-white/10 mb-6 w-full max-w-sm flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Elapsed Time</p>
                <div className="text-white"><LiveTimer startTime={log.startTime} /></div>
              </div>
              <Clock className="w-8 h-8 text-zinc-600" />
           </div>

           <button 
             onClick={handleStopClick} 
             disabled={isStopping}
             className="w-full max-w-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg shadow-red-900/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
           >
              {isStopping ? 'Stopping...' : <><StopCircle className="w-6 h-6" /> Stop Timer</>}
           </button>
        </div>

        <div className="bg-white/5 rounded-2xl p-6 border border-white/5 flex flex-col h-full opacity-90">
           <h3 className="text-zinc-400 font-bold uppercase text-sm mb-6 flex items-center gap-2">
             <Info className="w-4 h-4" /> Job Details
           </h3>
           {job ? (
             <>
               <div className="grid grid-cols-2 gap-y-6 gap-x-4 mb-6">
                  <div>
                    <label className="text-xs text-zinc-500 uppercase font-bold">Part Number</label>
                    <div className="text-lg md:text-xl font-bold text-white mt-1 break-words">{job.partNumber}</div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase font-bold">PO Number</label>
                    <div className="text-lg md:text-xl font-bold text-white mt-1 break-words">{job.poNumber}</div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase font-bold">Quantity</label>
                    <div className="text-lg md:text-xl font-bold text-white mt-1">{job.quantity} <span className="text-sm font-normal text-zinc-500">units</span></div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase font-bold">Due Date</label>
                    <div className="text-lg md:text-xl font-bold text-white mt-1">{job.dueDate || 'N/A'}</div>
                  </div>
               </div>
               
               <div className="mt-auto pt-6 border-t border-white/10">
                 <label className="text-xs text-zinc-500 uppercase font-bold mb-2 block">Notes / Instructions</label>
                 <div className="text-zinc-300 text-sm leading-relaxed bg-black/20 p-4 rounded-xl border border-white/5 min-h-[80px]">
                   {job.info || <span className="text-zinc-600 italic">No notes provided for this job.</span>}
                 </div>
               </div>
             </>
           ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-8 text-center">
               <AlertCircle className="w-12 h-12 mb-4 opacity-20" />
               <p>Job details not found.</p>
               <p className="text-xs mt-2">The job may have been deleted, but you can still track and stop time.</p>
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

// --- HELPER COMPONENT: JOB CARD ---
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden transition-all duration-300 ${expanded ? 'ring-2 ring-blue-500/50 bg-zinc-800' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div 
        className="p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-bold text-white">{job.jobIdsDisplay}</h3>
          <span className="bg-zinc-950 text-zinc-400 text-xs px-2 py-1 rounded font-mono">{job.quantity} units</span>
        </div>
        <div className="text-sm text-zinc-500 space-y-1">
          <p>Part: <span className="text-zinc-300">{job.partNumber}</span></p>
          <p>PO: {job.poNumber}</p>
        </div>
        
        {!expanded && (
          <div className="mt-4 flex items-center text-blue-400 text-xs font-bold uppercase tracking-wide">
            Tap to Start <ArrowRight className="w-3 h-3 ml-1" />
          </div>
        )}
      </div>

      {expanded && (
        <div className="p-4 bg-zinc-950/30 border-t border-white/5 animate-fade-in">
          <p className="text-xs text-zinc-500 uppercase font-bold mb-3">Select Operation:</p>
          <div className="grid grid-cols-2 gap-2">
            {operations.map(op => (
              <button
                key={op}
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(job.id, op);
                }}
                className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-2 px-3 rounded-lg text-sm text-zinc-300 transition-colors"
              >
                {op}
              </button>
            ))}
             {operations.length === 0 && <p className="col-span-2 text-xs text-zinc-500 text-center py-2">No operations configured.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

// --- EMPLOYEE DASHBOARD (REBUILT) ---
const EmployeeDashboard = ({ user, addToast, onLogout }: { user: User, addToast: any, onLogout: () => void }) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);
  const [ops, setOps] = useState<string[]>([]);

  useEffect(() => {
    // Load Settings
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
        addToast('success', 'Timer Started');
    } catch (e) {
        addToast('error', 'Failed to start timer');
    }
  };

  const handleStopJob = async (logId: string) => {
    try {
      await DB.stopTimeLog(logId);
      addToast('success', 'Job Stopped');
    } catch (e) {
      addToast('error', 'Failed to stop. Please try again.');
    }
  };

  const handleScan = (e: any) => {
      if (e.key === 'Enter') {
          let val = e.currentTarget.value.trim();
          const match = val.match(/[?&]jobId=([^&]+)/);
          if (match) val = match[1];
          setSearch(val); 
          setTab('jobs'); 
          addToast('success', 'Scanned');
      }
  }

  const filteredJobs = jobs.filter(j => 
    JSON.stringify(j).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {activeLog && (
        <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} />
      )}

      <div className="flex flex-wrap gap-2 justify-between items-center bg-zinc-900/50 backdrop-blur-md p-2 rounded-2xl border border-white/5 no-print">
         <div className="flex gap-2">
           <button onClick={() => setTab('jobs')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'jobs' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}>Jobs</button>
           <button onClick={() => setTab('history')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4" /> History</button>
         </div>
         <div className="flex items-center gap-2">
             <button onClick={() => setTab('scan')} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow' : 'bg-zinc-800 text-blue-400 hover:bg-blue-600 hover:text-white'}`}><ScanLine className="w-4 h-4" /> Scan</button>
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"><LogOut className="w-4 h-4" /> Exit</button>
         </div>
      </div>

      {tab === 'scan' ? (
         <div className="flex-1 flex items-center justify-center animate-fade-in py-12">
            <div className="bg-zinc-900 p-8 rounded-3xl border border-white/10 text-center max-w-sm w-full shadow-2xl">
               <QrCode className="w-16 h-16 mx-auto text-blue-500 mb-4" />
               <h2 className="text-2xl font-bold text-white mb-4">Scan Job QR</h2>
               <input autoFocus onKeyDown={handleScan} className="bg-black/50 border border-blue-500 rounded-xl px-4 py-3 text-white text-center w-full text-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Scan or Type..." />
               <p className="text-zinc-500 text-xs mt-4">Point scanner at Traveler QR code.</p>
            </div>
         </div>
      ) : tab === 'history' ? (
        <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden animate-fade-in">
          <div className="p-4 border-b border-white/5 bg-white/5"><h3 className="font-semibold text-white">Your Recent Activity</h3></div>
          <div className="overflow-y-auto max-h-[60vh]">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950/50 text-zinc-500"><tr><th className="p-4">Date</th><th className="p-4">Job</th><th className="p-4">Op</th><th className="p-4">Duration</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {myHistory.map(log => (
                  <tr key={log.id}>
                    <td className="p-4 text-zinc-400">{new Date(log.startTime).toLocaleDateString()}</td>
                    <td className="p-4 text-white font-medium">{log.jobId}</td>
                    <td className="p-4 text-zinc-300">{log.operation}</td>
                    <td className="p-4 text-zinc-400">{formatDuration(log.durationMinutes)}</td>
                  </tr>
                ))}
                {myHistory.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-zinc-500">No history found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col animate-fade-in">
          <div className="relative mb-6">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-zinc-500" />
            <input type="text" placeholder="Search by Job #, PO, or Part..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-zinc-900 border border-white/10 rounded-2xl pl-12 pr-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"/>
          </div>
          
          {activeLog && (
            <div className="mb-4 p-3 rounded-xl bg-blue-900/20 border border-blue-500/30 text-blue-300 text-sm text-center flex items-center justify-center gap-2">
              <Info className="w-4 h-4" /> You have a job running. Please stop it before starting a new one.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredJobs.map(job => (
              <JobSelectionCard key={job.id} job={job} onStart={handleStartJob} disabled={!!activeLog} operations={ops} />
            ))}
            {filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found matching "{search}".</div>}
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

// --- PRINTABLE JOB SHEET (TRAVELER) AS MODAL PREVIEW ---
const PrintableJobSheet = ({ job, onClose }: { job: Job | null, onClose: () => void }) => {
  if (!job) return null;
  
  const currentBaseUrl = window.location.href.split('?')[0];
  const deepLinkData = `${currentBaseUrl}?jobId=${job.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(deepLinkData)}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in overflow-y-auto print-overlay">
      <div className="bg-white text-black w-full max-w-3xl rounded-xl shadow-2xl relative overflow-hidden flex flex-col max-h-full print-content" id="printable-modal">
         
         {/* Toolbar (Hidden when printing) */}
         <div className="bg-zinc-900 text-white p-4 flex justify-between items-center no-print shrink-0 border-b border-zinc-700">
             <div>
               <h3 className="font-bold flex items-center gap-2 text-lg"><Printer className="w-5 h-5 text-blue-500"/> Print Preview</h3>
               <p className="text-xs text-zinc-400">Review details before printing.</p>
             </div>
             <div className="flex gap-3">
                 <button onClick={onClose} className="px-4 py-2 text-zinc-400 hover:text-white text-sm font-medium">Cancel</button>
                 <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 shadow-lg hover:shadow-blue-500/20 transition-all"><Printer className="w-4 h-4"/> Print Traveler</button>
             </div>
         </div>

         {/* Printable Content */}
         <div id="printable-area" className="flex-1 p-8 bg-white overflow-auto">
            {/* Header */}
            <div className="flex justify-between items-center border-b-4 border-black pb-4 mb-6">
              <div>
                 <h1 className="text-4xl font-black tracking-tighter">SC DEBURRING</h1>
                 <p className="text-sm font-bold uppercase tracking-widest text-gray-500 mt-2">Production Traveler</p>
              </div>
              <div className="text-right">
                 <h2 className="text-2xl font-bold">{new Date().toLocaleDateString()}</h2>
                 <p className="text-xs text-gray-400 mt-1">Printed On</p>
              </div>
            </div>

            {/* Main Info */}
            <div className="grid grid-cols-2 gap-8 mb-8 flex-1">
               <div className="space-y-6 flex flex-col">
                   <div className="border-4 border-black p-6">
                      <label className="block text-sm uppercase font-bold text-gray-500 mb-2">PO Number</label>
                      <div className="text-6xl font-black leading-none break-all">{job.poNumber}</div>
                   </div>
                   <div className="grid grid-cols-2 gap-6">
                      <div className="border-4 border-gray-300 p-4">
                         <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Part</label>
                         <div className="text-3xl font-bold break-words">{job.partNumber}</div>
                      </div>
                      <div className="border-4 border-gray-300 p-4">
                         <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Qty</label>
                         <div className="text-3xl font-bold">{job.quantity}</div>
                      </div>
                      <div className="border-4 border-gray-300 p-4">
                         <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Received</label>
                         <div className="text-xl font-bold">{job.dateReceived || '-'}</div>
                      </div>
                      <div className="border-4 border-gray-300 p-4">
                         <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Due Date</label>
                         <div className="text-2xl font-bold text-red-600">{job.dueDate || '-'}</div>
                      </div>
                   </div>
                   <div className="flex-1">
                     <label className="block text-sm uppercase font-bold text-gray-500 mb-2">Notes</label>
                     <div className="text-lg border-l-8 border-black pl-6 py-4 bg-gray-50 min-h-[6rem]">
                       {job.info || "No notes."}
                     </div>
                   </div>
               </div>
               
               <div className="flex flex-col items-center justify-center border-4 border-black p-8 bg-gray-50 h-full print-break-inside-avoid">
                  <img src={qrUrl} alt="QR Code" className="w-48 h-48 object-contain mix-blend-multiply" crossOrigin="anonymous" style={{maxWidth:'100%', maxHeight:'250px'}} />
                  <p className="font-mono text-lg mt-6 text-gray-500 text-center break-all">{job.id}</p>
                  <p className="font-bold uppercase tracking-widest text-2xl mt-2">SCAN JOB ID</p>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

// --- LOGIN ---
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
      <div className="space-y-6 animate-fade-in">
         {myActiveLog && (
            <ActiveJobPanel job={myActiveJob || null} log={myActiveLog} onStop={(id) => DB.stopTimeLog(id)} />
         )}

         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center relative overflow-hidden">
               <div className="relative z-10">
                   <p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Live Activity</p>
                   <h3 className="text-3xl font-black text-white">{liveJobsCount}</h3>
                   <p className="text-xs text-blue-400 mt-1">Jobs running now</p>
               </div>
               <Activity className={`w-10 h-10 text-blue-500 ${liveJobsCount > 0 ? 'animate-pulse' : 'opacity-20'}`} />
            </div>

            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
               <div>
                   <p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">In Progress</p>
                   <h3 className="text-3xl font-black text-white">{wipJobsCount}</h3>
                   <p className="text-xs text-zinc-500 mt-1">Total open jobs</p>
               </div>
               <Briefcase className="text-zinc-600 w-10 h-10" />
            </div>

            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
               <div>
                   <p className="text-zinc-500 text-sm font-bold uppercase tracking-wider">Floor Staff</p>
                   <h3 className="text-3xl font-black text-white">{activeWorkersCount}</h3>
                   <p className="text-xs text-zinc-500 mt-1">Clocked in</p>
               </div>
               <Users className="text-emerald-500 w-10 h-10" />
            </div>
         </div>
         
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col h-full">
                <div className="p-6 border-b border-white/5"><h3 className="font-bold text-white flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-500"/> Live Operations</h3></div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">
                   {activeLogs.length === 0 && <div className="p-8 text-center text-zinc-500">Floor is quiet. No active timers.</div>}
                   {activeLogs.map(l => (
                      <div key={l.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                         <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-zinc-400 border border-white/5">{l.userName.charAt(0)}</div>
                            <div>
                                <p className="font-bold text-white">{l.userName}</p>
                                <p className="text-xs text-zinc-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> {l.operation}</p>
                            </div>
                         </div>
                         <div className="flex items-center gap-4">
                            <div className="text-white text-xl font-bold font-mono"><LiveTimer startTime={l.startTime} /></div>
                            <button onClick={() => confirmAction({ title: "Force Stop", message: "Stop this timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white transition-colors"><Power className="w-4 h-4" /></button>
                         </div>
                      </div>
                   ))}
                </div>
             </div>

             <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col h-full">
                <div className="p-6 border-b border-white/5 flex justify-between items-center">
                    <h3 className="font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-blue-500"/> Recent Activity</h3>
                    <button onClick={() => setView('admin-logs')} className="text-xs text-blue-400 hover:text-white transition-colors">View All</button>
                </div>
                <div className="divide-y divide-white/5 flex-1 overflow-y-auto max-h-[400px]">
                   {logs.length === 0 && <div className="p-8 text-center text-zinc-500">No recent history.</div>}
                   {logs.map(l => (
                       <div key={l.id} className="p-4 flex items-start gap-3 hover:bg-white/5 transition-colors">
                           <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-500' : 'bg-emerald-500'}`}></div>
                           <div className="flex-1">
                               <p className="text-sm text-white">
                                   <span className="font-bold">{l.userName}</span> {l.endTime ? 'completed' : 'started'} <span className="text-zinc-300">{l.operation}</span>
                               </p>
                               <p className="text-xs text-zinc-500 mt-0.5">Job: {l.jobId} • {new Date(l.startTime).toLocaleTimeString()}</p>
                           </div>
                           {l.durationMinutes && (
                               <div className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-1 rounded">
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

// --- ADMIN: JOBS (REVAMPED) ---
const JobsView = ({ user, addToast, setPrintable, confirm }: any) => {
   const [jobs, setJobs] = useState<Job[]>([]);
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [aiLoading, setAiLoading] = useState(false);
   const [isSaving, setIsSaving] = useState(false);
   const [search, setSearch] = useState('');
   const [startJobModal, setStartJobModal] = useState<Job | null>(null);
   const [ops, setOps] = useState<string[]>([]);
   const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'priority'>('date-desc');
   const [historyRange, setHistoryRange] = useState<'week'|'month'|'year'|'all'>('week');
   // New Custom Date Range for History
   const [customStart, setCustomStart] = useState('');
   const [customEnd, setCustomEnd] = useState('');

   useEffect(() => {
       const u1 = DB.subscribeJobs(setJobs);
       setOps(DB.getSettings().customOperations);
       return () => { u1(); };
   }, []);

   const handleDelete = (id: string) => confirm({ title: "Delete", message: "Delete job?", onConfirm: () => DB.deleteJob(id) });
   const handleComplete = (id: string) => confirm({ title: "Complete Job", message: "Mark as done?", onConfirm: () => DB.completeJob(id) });
   const handleReopen = (id: string) => confirm({ title: "Reopen Job", message: "Move back to active?", onConfirm: () => DB.reopenJob(id) });

   const handleAdminStartJob = async (operation: string) => {
      if (!startJobModal) return;
      try {
          await DB.startTimeLog(startJobModal.id, user.id, user.name, operation);
          addToast('success', 'Operation Started');
          setStartJobModal(null);
      } catch (e: any) {
          addToast('error', 'Failed to start: ' + e.message);
      }
   };

   const handleSave = async () => {
    if (!editingJob.jobIdsDisplay || !editingJob.partNumber) return addToast('error', 'Missing fields');
    setIsSaving(true);
    const newJob: Job = {
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
    };
    try {
        await DB.saveJob(newJob);
        addToast('success', 'Job Saved');
        setShowModal(false);
        setEditingJob({});
    } catch(e) {
        addToast('error', 'Failed to save');
    }
    setIsSaving(false);
   };

   const handleAiParse = async (text: string) => {
    setAiLoading(true);
    try {
      const data = await parseJobDetails(text);
      setEditingJob(prev => ({ ...prev, ...data }));
      addToast('success', 'Parsed');
    } catch (e) { addToast('error', 'Parse Error'); } finally { setAiLoading(false); }
   };

   // Sort & Filter
   const filtered = useMemo(() => {
       const term = search.toLowerCase();
       return jobs.filter(j => 
           JSON.stringify(j).toLowerCase().includes(term)
       ).sort((a,b) => {
           if (sortBy === 'date-desc') return (b.createdAt || 0) - (a.createdAt || 0);
           if (sortBy === 'date-asc') return (a.createdAt || 0) - (b.createdAt || 0);
           if (sortBy === 'priority') {
              if (a.status === 'in-progress') return -1;
              if (b.status === 'in-progress') return 1;
              return (a.dueDate || '').localeCompare(b.dueDate || '');
           }
           return 0;
       });
   }, [jobs, search, sortBy]);

   const activeJobs = filtered.filter(j => j.status !== 'completed');
   
   // Completed Jobs with range filter
   const inRange = (dateStr?: string) => {
     if (!dateStr) return false;
     const d = new Date(dateStr).getTime();
     const now = Date.now();
     
     // Custom Date Range Override
     if (customStart && customEnd) {
         const start = new Date(customStart).getTime();
         const end = new Date(customEnd).getTime() + 86400000; // End of day
         return d >= start && d <= end;
     }

     if (historyRange === 'all') return true;
     const day = 24 * 60 * 60 * 1000;
     if (historyRange === 'week') return d >= now - 7 * day;
     if (historyRange === 'month') return d >= now - 30 * day;
     if (historyRange === 'year') return d >= now - 365 * day;
     return true;
   };

   // Prefer completedAt timestamp, fallback to dateReceived
   const completedJobsRaw = filtered.filter(j => j.status === 'completed');
   const completedInRange = completedJobsRaw.filter(j => {
       const dStr = j.completedAt ? new Date(j.completedAt).toISOString().split('T')[0] : j.dateReceived;
       return inRange(dStr);
   });

   const jobsCompletedCount = completedInRange.length;
   const unitsProcessed = completedInRange.reduce((s, j) => s + (Number(j.quantity) || 0), 0);

   return (
      <div className="space-y-6">
         <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <h2 className="text-2xl font-bold flex items-center gap-2"><Briefcase className="w-6 h-6 text-blue-500"/> Job Management</h2>
            <div className="flex gap-2 items-center">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Jobs..." className="pl-9 pr-4 py-2 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white w-48 md:w-64 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="relative">
                  <select value={sortBy} onChange={(e:any) => setSortBy(e.target.value)} className="appearance-none pl-4 pr-8 py-2 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white focus:outline-none cursor-pointer">
                     <option value="date-desc">Newest</option>
                     <option value="date-asc">Oldest</option>
                     <option value="priority">Priority</option>
                  </select>
                  <Filter className="absolute right-3 top-2.5 w-3 h-3 text-zinc-500 pointer-events-none" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-2 hover:bg-blue-500 shadow-lg shadow-blue-600/20"><Plus className="w-4 h-4"/> New Job</button>
            </div>
         </div>
         
         {/* ACTIVE PRODUCTION TABLE */}
         <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 bg-white/5">
                <div className="text-xs font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2">
                <Activity className="w-4 h-4" /> ACTIVE PRODUCTION
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                <thead className="bg-zinc-950/60 text-zinc-500">
                    <tr>
                    <th className="p-4">PO</th>
                    <th className="p-4">Job</th>
                    <th className="p-4">Part</th>
                    <th className="p-4">Qty</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Due Date</th>
                    <th className="p-4 text-right">Actions</th>
                    </tr>
                </thead>

                <tbody className="divide-y divide-white/5">
                    {activeJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold text-white">{job.poNumber || '-'}</td>
                        <td className="p-4 text-zinc-200">{job.jobIdsDisplay}</td>
                        <td className="p-4 text-zinc-300">{job.partNumber}</td>
                        <td className="p-4 font-mono text-white">{job.quantity}</td>

                        <td className="p-4">
                        <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide border
                            ${job.status === 'in-progress'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : job.status === 'pending'
                                ? 'bg-zinc-800 text-zinc-400 border-white/5'
                                : 'bg-zinc-800 text-zinc-400 border-white/5'
                            }`}>
                            <span className={`w-2 h-2 rounded-full ${job.status === 'in-progress' ? 'bg-blue-400' : 'bg-zinc-500'}`} />
                            {job.status}
                        </span>
                        </td>

                        <td className="p-4 text-zinc-400 font-mono">{job.dueDate || '—'}</td>

                        <td className="p-4">
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setStartJobModal(job)} className="p-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" title="Start">
                            <Play className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleComplete(job.id)} className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" title="Complete">
                            <CheckCircle className="w-4 h-4" />
                            </button>
                            <button onClick={() => setPrintable(job)} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700" title="Print">
                            <Printer className="w-4 h-4" />
                            </button>
                            <button onClick={() => { setEditingJob(job); setShowModal(true); }} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700" title="Edit">
                            <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(job.id)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20" title="Delete">
                            <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                        </td>
                    </tr>
                    ))}

                    {activeJobs.length === 0 && (
                    <tr>
                        <td colSpan={7} className="p-10 text-center text-zinc-500">
                        No active jobs found.
                        </td>
                    </tr>
                    )}
                </tbody>
                </table>
            </div>
         </div>

         {/* JOB HISTORY SECTION */}
         <section className="space-y-4 mt-10">
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
                <div>
                <h3 className="text-xl font-bold flex items-center gap-2">
                    <History className="w-5 h-5 text-zinc-400" /> Job History
                </h3>
                <p className="text-sm text-zinc-500">Completed production runs</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-xl p-1 px-3">
                        <span className="text-xs text-zinc-500 font-bold uppercase mr-1">Range:</span>
                        <input type="date" value={customStart} onChange={e => { setCustomStart(e.target.value); setHistoryRange('all'); }} className="bg-transparent text-white text-xs outline-none" />
                        <span className="text-zinc-500">-</span>
                        <input type="date" value={customEnd} onChange={e => { setCustomEnd(e.target.value); setHistoryRange('all'); }} className="bg-transparent text-white text-xs outline-none" />
                        {(customStart || customEnd) && (
                            <button onClick={() => { setCustomStart(''); setCustomEnd(''); }} className="ml-2 text-zinc-500 hover:text-white"><X className="w-3 h-3"/></button>
                        )}
                    </div>

                    <div className="inline-flex rounded-xl bg-zinc-900/60 border border-white/5 p-1">
                    {[
                        {k:'week', label:'WEEK'},
                        {k:'month', label:'MONTH'},
                        {k:'year', label:'YEAR'},
                        {k:'all', label:'ALL'},
                    ].map(x => (
                        <button
                        key={x.k}
                        onClick={() => { setHistoryRange(x.k as any); setCustomStart(''); setCustomEnd(''); }}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors
                            ${historyRange === x.k && !customStart ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}
                        >
                        {x.label}
                        </button>
                    ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
                <div className="text-xs text-zinc-500 font-bold uppercase">Jobs Completed</div>
                <div className="text-3xl font-black text-white mt-2">{jobsCompletedCount}</div>
                </div>
                <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
                <div className="text-xs text-zinc-500 font-bold uppercase">Units Processed</div>
                <div className="text-3xl font-black text-white mt-2">{unitsProcessed}</div>
                </div>
            </div>

            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-950/60 text-zinc-500">
                    <tr>
                        <th className="p-4">PO</th>
                        <th className="p-4">Job</th>
                        <th className="p-4">Part</th>
                        <th className="p-4">Qty</th>
                        <th className="p-4">Completed On</th>
                        <th className="p-4 text-right">Actions</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                    {completedInRange.map(job => (
                        <tr key={job.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-bold text-zinc-200">{job.poNumber || '-'}</td>
                        <td className="p-4 text-zinc-300">{job.jobIdsDisplay}</td>
                        <td className="p-4 text-zinc-400">{job.partNumber}</td>
                        <td className="p-4 font-mono text-white">{job.quantity}</td>
                        <td className="p-4 text-zinc-400 font-mono">
                           {job.completedAt ? new Date(job.completedAt).toLocaleDateString() : (job.dateReceived || '—')}
                        </td>

                        <td className="p-4">
                            <div className="flex justify-end gap-2">
                            <button onClick={() => handleReopen(job.id)} className="p-2 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20" title="Reopen">
                                <RotateCcw className="w-4 h-4" />
                            </button>
                            <button onClick={() => setPrintable(job)} className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700" title="Print">
                                <Printer className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(job.id)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20" title="Delete">
                                <Trash2 className="w-4 h-4" />
                            </button>
                            </div>
                        </td>
                        </tr>
                    ))}

                    {completedInRange.length === 0 && (
                        <tr>
                        <td colSpan={6} className="p-10 text-center text-zinc-500">
                            No completed jobs found for this range.
                        </td>
                        </tr>
                    )}
                    </tbody>
                </table>
                </div>
            </div>
         </section>

         {/* Modals remain the same */}
         {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <h3 className="font-bold text-white">Job Details</h3>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl">
                <div className="flex justify-between items-center mb-2"><label className="text-xs font-bold text-blue-300 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Smart Paste</label></div>
                <textarea placeholder="Paste email, message, or text here to auto-fill..." className="w-full bg-black/20 border border-blue-500/20 rounded-lg p-2 text-xs text-blue-200 focus:outline-none placeholder-blue-500/30" rows={2} onBlur={(e) => e.target.value && handleAiParse(e.target.value)} />
                {aiLoading && <p className="text-xs text-blue-400 mt-1 animate-pulse">Analyzing text...</p>}
              </div>
              
              <div>
                <label className="text-xs text-blue-400 font-bold uppercase tracking-wider ml-1 mb-1 block">PO Number (Required)</label>
                <input className="w-full bg-black/40 border-2 border-blue-500/50 rounded-xl p-3 text-white text-lg font-bold focus:ring-2 focus:ring-blue-500 outline-none placeholder-zinc-700" placeholder="e.g. PO-12345" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Job ID(s)</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Part Number</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Quantity</label><input type="number" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Due Date</label><input type="date" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
              </div>

              <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Date Received</label><input type="date" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.dateReceived || ''} onChange={e => setEditingJob({...editingJob, dateReceived: e.target.value})} /></div>
              
              <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Notes / Info</label><textarea className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" rows={3} value={editingJob.info || ''} onChange={e => setEditingJob({...editingJob, info: e.target.value})} /></div>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button>
              <button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-medium disabled:opacity-50">{isSaving ? 'Saving...' : 'Save Job'}</button>
            </div>
          </div>
        </div>
      )}
      
      {startJobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl shadow-2xl p-6">
             <h3 className="text-lg font-bold text-white mb-2">Start Operation</h3>
             <p className="text-sm text-zinc-400 mb-4">Select an operation for <strong>{startJobModal.jobIdsDisplay}</strong> ({startJobModal.partNumber})</p>
             <div className="grid grid-cols-2 gap-2">
               {ops.map(op => (
                 <button
                   key={op}
                   onClick={() => handleAdminStartJob(op)}
                   className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-3 px-3 rounded-xl text-sm font-medium text-zinc-300 transition-colors"
                 >
                   {op}
                 </button>
               ))}
               {ops.length === 0 && <p className="col-span-2 text-center text-sm text-zinc-500">No operations defined. Check Settings.</p>}
             </div>
             <div className="mt-4 flex justify-end">
               <button onClick={() => setStartJobModal(null)} className="text-zinc-500 hover:text-white text-sm">Cancel</button>
             </div>
          </div>
        </div>
      )}
      </div>
   )
}

// --- ADMIN: LOGS (REVAMPED) ---
const LogsView = ({ addToast }: { addToast: any }) => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [users, setUsers] = useState<User[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [refreshKey, setRefreshKey] = useState(0);
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
   const [showEditModal, setShowEditModal] = useState(false);
   const [ops, setOps] = useState<string[]>([]);
   
   // COMPLEX FILTERS
   const [filter, setFilter] = useState('');
   const [filterUser, setFilterUser] = useState('');
   const [filterOp, setFilterOp] = useState('');
   const [customStart, setCustomStart] = useState('');
   const [customEnd, setCustomEnd] = useState('');
   const [range, setRange] = useState<'week'|'month'|'year'|'all'>('week');

   useEffect(() => {
     const unsub1 = DB.subscribeLogs(setLogs);
     const unsub2 = DB.subscribeJobs(setJobs);
     const unsub3 = DB.subscribeUsers(setUsers);
     setOps(DB.getSettings().customOperations);
     return () => { unsub1(); unsub2(); unsub3(); };
   }, [refreshKey]);

   // Filter Logic
   const inDateRange = (ts: number) => {
      // Custom Range Overrides
      if (customStart && customEnd) {
          const s = new Date(customStart).getTime();
          const e = new Date(customEnd).getTime() + 86400000;
          return ts >= s && ts <= e;
      }
      if (range === 'all') return true;
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      if (range === 'week') return ts >= now - 7 * day;
      if (range === 'month') return ts >= now - 30 * day;
      if (range === 'year') return ts >= now - 365 * day;
      return true;
   };

   const filteredLogs = useMemo(() => {
      const term = filter.toLowerCase();
      return logs
        .filter(l => inDateRange(l.startTime))
        .filter(l => {
             // Text Search
             const job = jobs.find(j => j.id === l.jobId);
             const searchStr = `${l.userName} ${l.operation} ${l.jobId} ${job?.poNumber || ''} ${job?.partNumber || ''} ${job?.jobIdsDisplay || ''}`.toLowerCase();
             if (!searchStr.includes(term)) return false;
             
             // Dropdown Filters
             if (filterUser && l.userId !== filterUser) return false;
             if (filterOp && l.operation !== filterOp) return false;
             
             return true;
        });
   }, [logs, range, filter, filterUser, filterOp, customStart, customEnd, jobs]);

   // SPLIT INTO ACTIVE JOB LOGS vs COMPLETED JOB LOGS
   const { activeJobLogs, completedJobLogs } = useMemo(() => {
       const active: Record<string, TimeLog[]> = {};
       const completed: Record<string, TimeLog[]> = {};

       filteredLogs.forEach(log => {
           const job = jobs.find(j => j.id === log.jobId);
           const isCompleted = job?.status === 'completed';
           const target = isCompleted ? completed : active;
           (target[log.jobId] ||= []).push(log);
       });

       return { activeJobLogs: active, completedJobLogs: completed };
   }, [filteredLogs, jobs]);

   // Stats
   const totalRecords = filteredLogs.length;
   const uniqueJobs = new Set(filteredLogs.map(l => l.jobId)).size;
   const totalMinutes = filteredLogs.reduce((s, l) => s + (l.durationMinutes || 0), 0);
   const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

   const handleEditLog = (log: TimeLog) => {
       setEditingLog({...log});
       setShowEditModal(true);
   };

   const handleSaveLog = async () => {
       if (!editingLog) return;
       try {
           if (editingLog.endTime && editingLog.endTime < editingLog.startTime) {
               addToast('error', 'End time cannot be before Start time');
               return;
           }
           await DB.updateTimeLog(editingLog);
           addToast('success', 'Log updated successfully');
           setShowEditModal(false);
           setEditingLog(null);
       } catch(e) {
           addToast('error', 'Failed to update log');
       }
   };

   const handleDeleteLog = async () => {
       if (!editingLog) return;
       if (!window.confirm("Are you sure you want to permanently delete this log record?")) return;
       try {
           await DB.deleteTimeLog(editingLog.id);
           addToast('success', 'Log deleted');
           setShowEditModal(false);
           setEditingLog(null);
       } catch(e) {
           addToast('error', 'Failed to delete log');
       }
   };

   const renderGroup = (groups: Record<string, TimeLog[]>, title: string, icon: any) => {
       if (Object.keys(groups).length === 0) return null;
       return (
           <div className="space-y-4 mb-8">
               <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500 border-b border-white/5 pb-2">
                   {icon} {title} ({Object.keys(groups).length})
               </div>
               {Object.entries(groups).map(([jobId, entries]) => {
                    const job = jobs.find(j => j.id === jobId);
                    const po = job?.poNumber || '—';
                    const part = job?.partNumber || '—';
                    const jobLabel = job?.jobIdsDisplay || jobId;
                    const totalMins = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);

                    return (
                        <div key={jobId} className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden shadow-sm">
                            <div className="bg-white/5 px-6 py-4 border-b border-white/5 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                        <Briefcase className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="text-lg font-bold text-white">{jobLabel}</div>
                                        <div className="text-xs text-zinc-500 flex gap-2">
                                            <span className="bg-zinc-950 px-2 py-1 rounded-md border border-white/5">PO: {po}</span>
                                            <span className="bg-zinc-950 px-2 py-1 rounded-md border border-white/5">Part: {part}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs text-zinc-500 font-bold uppercase">Total Time</div>
                                    <div className="text-white font-black">{formatDuration(totalMins)}</div>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-zinc-950/60 text-zinc-500">
                                        <tr>
                                            <th className="p-4">Date</th>
                                            <th className="p-4">Time Range</th>
                                            <th className="p-4">Employee</th>
                                            <th className="p-4">Operation</th>
                                            <th className="p-4 text-right">Duration</th>
                                            <th className="p-4 text-right"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {entries.sort((a,b) => b.startTime - a.startTime).map(l => (
                                            <tr key={l.id} className="hover:bg-white/5 transition-colors">
                                                <td className="p-4 text-zinc-300">{new Date(l.startTime).toLocaleDateString()}</td>
                                                <td className="p-4 font-mono text-zinc-300">
                                                    {new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                                    <span className="text-zinc-600 mx-2">—</span>
                                                    {l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : <span className="text-emerald-400 font-bold text-xs">ACTIVE</span>}
                                                </td>
                                                <td className="p-4 text-white font-medium">{l.userName}</td>
                                                <td className="p-4"><span className="px-3 py-1 bg-zinc-800 border border-white/5 rounded-lg text-xs font-bold text-zinc-200">{l.operation}</span></td>
                                                <td className="p-4 text-right font-mono text-zinc-300">{formatDuration(l.durationMinutes)}</td>
                                                <td className="p-4 text-right">
                                                    <button onClick={() => handleEditLog(l)} className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800"><Edit2 className="w-4 h-4" /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
               })}
           </div>
       );
   };

   return (
      <div className="space-y-6">
         {/* HEADER */}
         <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
                <Calendar className="w-6 h-6 text-blue-500" /> Work Logs
            </h2>
            <button onClick={() => setRefreshKey(k => k + 1)} className="p-2 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 self-end md:self-auto" title="Refresh">
               <RefreshCw className="w-4 h-4" />
            </button>
         </div>

         {/* COMPLEX FILTER BAR */}
         <div className="bg-zinc-900/50 border border-white/10 p-4 rounded-2xl space-y-4">
             <div className="flex flex-col md:flex-row gap-4">
                 <div className="flex-1 relative">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-zinc-500" />
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search Logs..." className="w-full pl-9 pr-4 py-2.5 bg-black/40 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500" />
                 </div>
                 <div className="flex gap-2 w-full md:w-auto">
                     <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="flex-1 md:w-40 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
                         <option value="">All Employees</option>
                         {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                     </select>
                     <select value={filterOp} onChange={e => setFilterOp(e.target.value)} className="flex-1 md:w-40 bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
                         <option value="">All Operations</option>
                         {ops.map(o => <option key={o} value={o}>{o}</option>)}
                     </select>
                 </div>
             </div>
             
             <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/5">
                 <span className="text-xs font-bold text-zinc-500 uppercase">Date Range:</span>
                 <div className="flex items-center gap-2 bg-black/20 rounded-lg p-1">
                     <input type="date" value={customStart} onChange={e => { setCustomStart(e.target.value); setRange('all'); }} className="bg-transparent text-white text-xs p-1 outline-none" />
                     <span className="text-zinc-600">-</span>
                     <input type="date" value={customEnd} onChange={e => { setCustomEnd(e.target.value); setRange('all'); }} className="bg-transparent text-white text-xs p-1 outline-none" />
                 </div>
                 <div className="flex gap-1">
                     {['week', 'month', 'year', 'all'].map((r: any) => (
                         <button key={r} onClick={() => { setRange(r); setCustomStart(''); setCustomEnd(''); }} className={`px-3 py-1 rounded-md text-xs font-bold uppercase ${range === r && !customStart ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-white bg-zinc-800'}`}>{r}</button>
                     ))}
                 </div>
             </div>
         </div>

         {/* KPI CARDS */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6">
                <div className="text-xs text-blue-300 font-bold uppercase">Total Hours</div>
                <div className="text-3xl font-black text-white mt-2">{totalHours} <span className="text-base font-bold text-blue-300">hrs</span></div>
            </div>
            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
                <div className="text-xs text-zinc-500 font-bold uppercase">Total Records</div>
                <div className="text-3xl font-black text-white mt-2">{totalRecords}</div>
            </div>
            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-6">
                <div className="text-xs text-zinc-500 font-bold uppercase">Unique Jobs</div>
                <div className="text-3xl font-black text-white mt-2">{uniqueJobs}</div>
            </div>
         </div>

         {/* CONTENT SPLIT */}
         {totalRecords === 0 ? (
             <div className="text-center p-12 text-zinc-500 border border-dashed border-white/10 rounded-2xl">No logs found matching your criteria.</div>
         ) : (
             <>
                 {renderGroup(activeJobLogs, "Active Jobs Logs", <Activity className="w-4 h-4 text-blue-400"/>)}
                 {renderGroup(completedJobLogs, "Completed Jobs Logs", <CheckCircle className="w-4 h-4 text-emerald-500"/>)}
             </>
         )}

         {/* EDIT MODAL */}
         {showEditModal && editingLog && (
             <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                 <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
                     <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
                         <h3 className="font-bold text-white flex items-center gap-2"><Edit2 className="w-4 h-4 text-blue-500" /> Edit Time Log</h3>
                         <button onClick={() => setShowEditModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
                     </div>
                     <div className="p-6 space-y-5">
                         <div>
                             <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Employee</label>
                             <select 
                                 className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                 value={editingLog.userId}
                                 onChange={e => {
                                     const u = users.find(u => u.id === e.target.value);
                                     if(u) setEditingLog({...editingLog, userId: u.id, userName: u.name});
                                 }}
                             >
                                 {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                             </select>
                         </div>
                         <div>
                             <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Operation</label>
                             <select 
                                 className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                 value={editingLog.operation}
                                 onChange={e => setEditingLog({...editingLog, operation: e.target.value})}
                             >
                                 {ops.map(o => <option key={o} value={o}>{o}</option>)}
                                 {!ops.includes(editingLog.operation) && <option value={editingLog.operation}>{editingLog.operation} (Legacy)</option>}
                             </select>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                             <div>
                                 <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Start Time</label>
                                 <input 
                                     type="datetime-local" 
                                     className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                                     value={toDateTimeLocal(editingLog.startTime)}
                                     onChange={e => setEditingLog({...editingLog, startTime: new Date(e.target.value).getTime()})}
                                 />
                             </div>
                             <div>
                                 <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">End Time</label>
                                 <input 
                                     type="datetime-local" 
                                     className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                                     value={toDateTimeLocal(editingLog.endTime)}
                                     onChange={e => {
                                         const val = e.target.value ? new Date(e.target.value).getTime() : null;
                                         setEditingLog({...editingLog, endTime: val});
                                     }}
                                 />
                                 <p className="text-[10px] text-zinc-500 mt-1">Clear to mark as active.</p>
                             </div>
                         </div>
                     </div>
                     <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-between items-center">
                         <button onClick={handleDeleteLog} className="text-red-500 hover:text-red-400 text-sm font-bold flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"><Trash2 className="w-4 h-4"/> Delete Log</button>
                         <div className="flex gap-2">
                             <button onClick={() => setShowEditModal(false)} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button>
                             <button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-bold shadow-lg shadow-blue-900/20">Save Changes</button>
                         </div>
                     </div>
                 </div>
             </div>
         )}
      </div>
   )
}

// --- ADMIN: EMPLOYEES ---
const AdminEmployees = ({ addToast, confirm }: { addToast: any, confirm: any }) => {
   const [users, setUsers] = useState<User[]>([]);
   const [editingUser, setEditingUser] = useState<Partial<User>>({});
   const [showModal, setShowModal] = useState(false);

   useEffect(() => DB.subscribeUsers(setUsers), []);

   const handleDelete = (id: string) => confirm({
      title: "Remove User",
      message: "Are you sure you want to remove this user? This cannot be undone.",
      onConfirm: () => DB.deleteUser(id)
   });

   const handleSave = () => {
     if (!editingUser.name || !editingUser.username || !editingUser.pin) return addToast('error', 'Missing fields');
     const newUser: User = {
       id: editingUser.id || Date.now().toString(),
       name: editingUser.name,
       username: editingUser.username,
       pin: editingUser.pin,
       role: editingUser.role || 'employee',
       isActive: editingUser.isActive !== false
     };
     DB.saveUser(newUser);
     setShowModal(false);
     setEditingUser({});
     addToast('success', 'User Saved');
   };

   return (
     <div className="space-y-6">
        <div className="flex justify-between items-center"><h2 className="text-2xl font-bold text-white">Team</h2><button onClick={() => { setEditingUser({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2"><Plus className="w-4 h-4" /> Add Member</button></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {users.map(u => (
            <div key={u.id} className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400"><UserIcon className="w-5 h-5" /></div>
                <div><p className="font-bold text-white">{u.name}</p><p className="text-xs text-zinc-500">@{u.username} • {u.role}</p></div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => handleDelete(u.id)} className="p-2 hover:bg-red-500/10 rounded-lg text-zinc-500 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                 <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"><Edit2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
             <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50"><h3 className="font-bold text-white">User Details</h3><button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button></div>
                <div className="p-6 space-y-4">
                  <div><label className="text-xs text-zinc-500 ml-1">Full Name</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.name || ''} onChange={e => setEditingUser({...editingUser, name: e.target.value})} /></div>
                  <div><label className="text-xs text-zinc-500 ml-1">Username</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.username || ''} onChange={e => setEditingUser({...editingUser, username: e.target.value})} /></div>
                  <div><label className="text-xs text-zinc-500 ml-1">PIN</label><input type="text" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.pin || ''} onChange={e => setEditingUser({...editingUser, pin: e.target.value})} /></div>
                  <div><label className="text-xs text-zinc-500 ml-1">Role</label><select className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingUser.role || 'employee'} onChange={e => setEditingUser({...editingUser, role: e.target.value as any})}><option value="employee">Employee</option><option value="admin">Admin</option></select></div>
                </div>
                <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-2"><button onClick={() => setShowModal(false)} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-medium">Save</button></div>
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

   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Updated'); };
   
   const handleAddOp = () => {
       if(!newOp.trim()) return;
       const ops = settings.customOperations || [];
       if(ops.includes(newOp.trim())) return;
       setSettings({...settings, customOperations: [...ops, newOp.trim()]});
       setNewOp('');
   };
   
   const handleDeleteOp = (op: string) => {
       setSettings({...settings, customOperations: (settings.customOperations || []).filter(o => o !== op)});
   };

   return (
     <div className="max-w-xl space-y-6">
        <h2 className="text-2xl font-bold text-white">System Settings</h2>
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6">
           <div className="flex items-center gap-3 mb-6 pb-6 border-b border-white/5"><div className="bg-orange-500/20 p-2 rounded-lg text-orange-400"><Clock className="w-6 h-6" /></div><div><h3 className="font-bold text-white">Auto-Cleanup Rules</h3><p className="text-sm text-zinc-500">Automatically clock out forgotton timers.</p></div></div>
           <div className="space-y-4">
             <div className="flex items-center justify-between"><label className="text-sm text-zinc-300">Enable Auto-Clock Out</label><input type="checkbox" checked={settings.autoClockOutEnabled} onChange={e => setSettings({...settings, autoClockOutEnabled: e.target.checked})} className="w-5 h-5 rounded bg-zinc-800 border-white/10 text-blue-600 focus:ring-blue-500" /></div>
             <div><label className="text-xs text-zinc-500 block mb-1">Auto-Clock Out Time</label><input type="time" value={settings.autoClockOutTime} onChange={e => setSettings({...settings, autoClockOutTime: e.target.value})} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" /></div>
           </div>
        </div>

        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-3 mb-6 pb-6 border-b border-white/5"><div className="bg-blue-500/20 p-2 rounded-lg text-blue-400"><Activity className="w-6 h-6" /></div><div><h3 className="font-bold text-white">Production Operations</h3><p className="text-sm text-zinc-500">Customize the workflow steps available for tracking.</p></div></div>
            <div className="space-y-4">
                <div className="flex gap-2">
                    <input value={newOp} onChange={e => setNewOp(e.target.value)} placeholder="New Operation Name..." className="flex-1 bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" onKeyDown={e => e.key === 'Enter' && handleAddOp()} />
                    <button onClick={handleAddOp} className="bg-blue-600 px-4 rounded-lg text-white font-bold"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(settings.customOperations || []).map(op => (
                        <div key={op} className="bg-zinc-800 border border-white/10 px-3 py-1.5 rounded-lg flex items-center gap-2">
                            <span>{op}</span>
                            <button onClick={() => handleDeleteOp(op)} className="text-zinc-500 hover:text-red-500"><X className="w-3 h-3" /></button>
                        </div>
                    ))}
                    {(settings.customOperations || []).length === 0 && <span className="text-zinc-500 italic text-sm">No operations defined.</span>}
                </div>
            </div>
        </div>

        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2"><Save className="w-5 h-5" /> Save Changes</button></div>
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