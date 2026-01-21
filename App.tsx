import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink, RefreshCw, Calculator
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

const formatDurationDecimal = (mins: number | undefined) => {
    if (mins === undefined || mins === null) return 0;
    return (mins / 60).toFixed(2);
};

// --- PRINT STYLES ---
const PrintStyles = () => (
  <style>{`
    @media print {
      body * { visibility: hidden; }
      #printable-area, #printable-area * { visibility: visible; }
      #printable-area { 
        position: absolute; 
        left: 0; 
        top: 0; 
        width: 100%; 
        height: 100%; 
        z-index: 99999; 
        background: white; 
        color: black; 
        overflow: visible;
      }
      @page { size: auto; margin: 0mm; }
      .no-print { display: none !important; }
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
    <div className="bg-zinc-900 border border-blue-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mb-8">
      {/* Background Pulse/Gradient */}
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none"><Briefcase className="w-64 h-64 text-blue-500" /></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-50 animate-pulse"></div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
        {/* Left: Timer & Control */}
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

        {/* Right: Details Grid */}
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
const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean }> = ({ job, onStart, disabled }) => {
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
            {['Cutting', 'Deburring', 'Polishing', 'Assembly', 'QC', 'Packing'].map(op => (
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
          </div>
        </div>
      )}
    </div>
  );
};

// --- EMPLOYEE DASHBOARD (REBUILT) ---
const EmployeeDashboard = ({ 
  user, 
  addToast, 
  onLogout,
  initialJobId,
  onConsumeInitialId
}: { 
  user: User, 
  addToast: any, 
  onLogout: () => void,
  initialJobId?: string | null,
  onConsumeInitialId?: () => void
}) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);

  // Deep Link Handling
  useEffect(() => {
    if (initialJobId) {
        setSearch(initialJobId);
        setTab('jobs');
        addToast('success', 'Job Loaded from Scan');
        if (onConsumeInitialId) onConsumeInitialId();
    }
  }, [initialJobId, onConsumeInitialId, addToast]);

  // Use DB subscriptions to get real-time updates
  useEffect(() => {
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
    } catch (e: any) {
        console.error("Timer Start Error:", e);
        // More descriptive error for the user
        addToast('error', 'Failed to start: ' + (e.message || "Unknown Error"));
    }
  };

  const handleStopJob = async (logId: string) => {
    try {
      await DB.stopTimeLog(logId);
      addToast('success', 'Job Stopped');
    } catch (e) {
      console.error("Stop failed", e);
      addToast('error', 'Failed to stop. Please try again.');
      throw e; // Re-throw to inform UI
    }
  };

  const handleScan = (e: any) => {
      if (e.key === 'Enter') {
          let val = e.currentTarget.value.trim();
          // Handle deep link URLs from scan
          if (val.includes('jobId=')) {
              try {
                  const url = new URL(val);
                  const id = url.searchParams.get('jobId');
                  if (id) val = id;
              } catch (e) {
                  // Fallback regex if not full valid url
                  const match = val.match(/[?&]jobId=([^&]+)/);
                  if (match) val = match[1];
              }
          }
          
          setSearch(val); 
          setTab('jobs'); 
          addToast('success', 'Scanned');
          e.currentTarget.select();
      }
  }

  const filteredJobs = jobs.filter(j => {
    const term = search.toLowerCase();
    return j.id === search || JSON.stringify(j).toLowerCase().includes(term);
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {/* 1. ACTIVE JOB PANEL */}
      {activeLog && (
        <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} />
      )}

      {/* 2. NAVIGATION TABS */}
      <div className="flex flex-wrap gap-2 justify-between items-center bg-zinc-900/50 backdrop-blur-md p-2 rounded-2xl border border-white/5">
         <div className="flex gap-2">
           <button onClick={() => setTab('jobs')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === 'jobs' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}>Jobs</button>
           <button onClick={() => setTab('history')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4" /> History</button>
         </div>
         <div className="flex items-center gap-2">
             <button onClick={() => setTab('scan')} className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${tab === 'scan' ? 'bg-blue-600 text-white shadow' : 'bg-zinc-800 text-blue-400 hover:bg-blue-600 hover:text-white'}`}><ScanLine className="w-4 h-4" /> Scan</button>
             
             {/* PROMINENT EXIT BUTTON */}
             <button onClick={onLogout} className="bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"><LogOut className="w-4 h-4" /> Exit</button>
         </div>
      </div>

      {/* 3. CONTENT AREA */}
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
              <JobSelectionCard key={job.id} job={job} onStart={handleStartJob} disabled={!!activeLog} />
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
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
  
  // Generates a deep link QR code to open this specific job
  const currentBaseUrl = window.location.href.split('?')[0];
  const deepLinkData = `${currentBaseUrl}?jobId=${job.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(deepLinkData)}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white text-black w-full max-w-3xl rounded-xl shadow-2xl relative overflow-hidden flex flex-col max-h-full">
         
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
                 <p className="text-sm font-bold uppercase tracking-widest text-gray-500">Production Traveler</p>
              </div>
              <div className="text-right">
                 <h2 className="text-2xl font-bold">{new Date().toLocaleDateString()}</h2>
                 <p className="text-xs text-gray-400">Printed On</p>
              </div>
            </div>

            {/* Main Info */}
            <div className="grid grid-cols-2 gap-8 mb-8">
               <div className="space-y-6">
                   <div className="border-2 border-black p-4">
                      <label className="block text-xs uppercase font-bold text-gray-500">PO Number</label>
                      <div className="text-4xl font-black">{job.poNumber}</div>
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div className="border border-gray-300 p-2">
                         <label className="block text-xs uppercase font-bold text-gray-500">Part</label>
                         <div className="text-xl font-bold">{job.partNumber}</div>
                      </div>
                      <div className="border border-gray-300 p-2">
                         <label className="block text-xs uppercase font-bold text-gray-500">Qty</label>
                         <div className="text-xl font-bold">{job.quantity}</div>
                      </div>
                      {/* NEW FIELDS */}
                      <div className="border border-gray-300 p-2">
                         <label className="block text-xs uppercase font-bold text-gray-500">Received</label>
                         <div className="text-xl font-bold">{job.dateReceived || '-'}</div>
                      </div>
                      <div className="border border-gray-300 p-2">
                         <label className="block text-xs uppercase font-bold text-gray-500">Due Date</label>
                         <div className="text-xl font-bold text-red-600">{job.dueDate || '-'}</div>
                      </div>
                   </div>
                   <div>
                     <label className="block text-xs uppercase font-bold text-gray-500 mb-1">Notes</label>
                     <div className="text-sm border-l-4 border-black pl-4 py-2 bg-gray-50 min-h-[4rem]">
                       {job.info || "No notes."}
                     </div>
                   </div>
               </div>
               
               <div className="flex flex-col items-center justify-center border-2 border-black p-4 bg-gray-50">
                  <img src={qrUrl} alt="QR Code" className="w-full max-w-[400px] h-auto mix-blend-multiply" />
                  <p className="font-mono text-xs mt-2 text-gray-500">{job.id}</p>
                  <p className="font-bold uppercase tracking-widest text-sm mt-1">SCAN JOB ID</p>
               </div>
            </div>

            {/* REMOVED Operations Checklist */}
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
const AdminDashboard = ({ confirmAction }: any) => {
   const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);

   useEffect(() => {
     const unsub1 = DB.subscribeActiveLogs(setActiveLogs);
     const unsub2 = DB.subscribeJobs(setJobs);
     return () => { unsub1(); unsub2(); };
   }, []);

   const stats = {
      jobs: jobs.filter(j => j.status === 'in-progress').length,
      workers: new Set(activeLogs.map(l => l.userId)).size
   };

   return (
      <div className="space-y-6 animate-fade-in">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
               <div><p className="text-zinc-500 text-sm">Active Jobs</p><h3 className="text-3xl font-bold text-white">{stats.jobs}</h3></div>
               <Briefcase className="text-blue-500 w-8 h-8" />
            </div>
            <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
               <div><p className="text-zinc-500 text-sm">Floor Staff</p><h3 className="text-3xl font-bold text-white">{stats.workers}</h3></div>
               <Users className="text-emerald-500 w-8 h-8" />
            </div>
         </div>

         <div className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
            <div className="p-6 border-b border-white/5"><h3 className="font-bold text-white">Live Activity</h3></div>
            <div className="divide-y divide-white/5">
               {activeLogs.length === 0 && <div className="p-8 text-center text-zinc-500">Floor is quiet.</div>}
               {activeLogs.map(l => (
                  <div key={l.id} className="p-4 flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center font-bold text-zinc-400">{l.userName.charAt(0)}</div>
                        <div><p className="font-bold text-white">{l.userName}</p><p className="text-xs text-zinc-500">{l.operation}</p></div>
                     </div>
                     <div className="flex items-center gap-4">
                        <div className="text-white"><LiveTimer startTime={l.startTime} /></div>
                        <button onClick={() => confirmAction({ title: "Force Stop", message: "Stop this timer?", onConfirm: () => DB.stopTimeLog(l.id) })} className="bg-red-500/10 text-red-500 p-2 rounded-lg hover:bg-red-500 hover:text-white"><Power className="w-4 h-4" /></button>
                     </div>
                  </div>
               ))}
            </div>
         </div>
      </div>
   );
};

// --- ADMIN: JOBS (REVAMPED) ---
const JobsView = ({ addToast, setPrintable, confirm }: any) => {
   const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
   const [jobs, setJobs] = useState<Job[]>([]);
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [aiLoading, setAiLoading] = useState(false);
   const [isSaving, setIsSaving] = useState(false);
   const [search, setSearch] = useState('');

   useEffect(() => {
       const u1 = DB.subscribeJobs(setJobs);
       return () => { u1(); };
   }, []);

   const handleDelete = (id: string) => confirm({ title: "Delete", message: "Delete job?", onConfirm: () => DB.deleteJob(id) });
   const handleComplete = (id: string) => confirm({ title: "Complete Job", message: "Mark as done?", onConfirm: () => DB.completeJob(id) });
   const handleReopen = (id: string) => confirm({ title: "Reopen Job", message: "Move back to active?", onConfirm: () => DB.reopenJob(id) });

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

   // Filtering Logic
   const filteredJobs = jobs.filter(j => {
      const matchesSearch = JSON.stringify(j).toLowerCase().includes(search.toLowerCase());
      if (activeTab === 'active') return matchesSearch && j.status !== 'completed';
      return matchesSearch && j.status === 'completed';
   }).sort((a,b) => {
       // Sort active by due date, history by completed date
       if (activeTab === 'active') return (a.dueDate || '').localeCompare(b.dueDate || '');
       return (b.completedAt || 0) - (a.completedAt || 0);
   });

   return (
      <div className="space-y-6">
         <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <h2 className="text-2xl font-bold">Job Management</h2>
            <div className="flex gap-2">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={activeTab === 'active' ? "Search Active..." : "Search History..."} className="pl-9 pr-4 py-2 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white w-64 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-2 hover:bg-blue-500"><Plus className="w-4 h-4"/> New Job</button>
            </div>
         </div>
         
         <div className="flex gap-4 border-b border-white/5">
             <button onClick={() => setActiveTab('active')} className={`pb-3 px-1 text-sm font-bold transition-all ${activeTab === 'active' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-zinc-500 hover:text-white'}`}>Active Production</button>
             <button onClick={() => setActiveTab('history')} className={`pb-3 px-1 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'history' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4"/> Job History</button>
         </div>

         <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-sm text-left"><thead className="bg-white/5 text-zinc-500"><tr><th className="p-4">PO</th><th className="p-4">Job</th><th className="p-4">Part</th><th className="p-4">Status</th><th className="p-4">{activeTab === 'active' ? 'Due Date' : 'Completed'}</th><th className="p-4 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-white/5">{filteredJobs.map(j => (
               <tr key={j.id} className="hover:bg-white/5 transition-colors">
                  <td className="p-4 text-white font-bold">{j.poNumber}</td>
                  <td className="p-4 text-zinc-300 font-mono">{j.jobIdsDisplay}</td>
                  <td className="p-4 text-zinc-400">{j.partNumber}</td>
                  <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs uppercase font-bold tracking-wide ${j.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400 animate-pulse' : j.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-zinc-500'}`}>
                          {j.status}
                      </span>
                  </td>
                  <td className="p-4 text-zinc-400">
                      {activeTab === 'active' ? (j.dueDate || '-') : (j.completedAt ? new Date(j.completedAt).toLocaleDateString() : '-')}
                  </td>
                  <td className="p-4 text-right flex justify-end gap-2">
                     {activeTab === 'active' ? (
                        <button onClick={() => handleComplete(j.id)} className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg hover:bg-emerald-500 hover:text-white transition-colors" title="Complete"><CheckCircle className="w-4 h-4"/></button>
                     ) : (
                        <button onClick={() => handleReopen(j.id)} className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500 hover:text-white transition-colors" title="Reopen"><RotateCcw className="w-4 h-4"/></button>
                     )}
                     <button onClick={() => setPrintable(j)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700" title="Print"><Printer className="w-4 h-4"/></button>
                     <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 bg-zinc-800 rounded-lg text-blue-400 hover:text-white hover:bg-blue-600" title="Edit"><Edit2 className="w-4 h-4"/></button>
                     <button onClick={() => handleDelete(j.id)} className="p-2 bg-zinc-800 rounded-lg text-red-400 hover:text-white hover:bg-red-600" title="Delete"><Trash2 className="w-4 h-4"/></button>
                  </td>
               </tr>
            ))}
            {filteredJobs.length === 0 && <tr><td colSpan={6} className="p-12 text-center text-zinc-500">No jobs found in {activeTab} view.</td></tr>}
            </tbody></table>
         </div>

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
              
              {/* REORGANIZED FIELDS: PO FIRST, PROMINENT */}
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
      </div>
   )
}

// --- ADMIN: LOGS ---
const LogsView = () => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [search, setSearch] = useState('');
   const [timeFilter, setTimeFilter] = useState<'all' | 'week' | 'month' | 'year'>('week');
   const [refreshKey, setRefreshKey] = useState(0);

   useEffect(() => {
     // Trigger subscription refresh when key changes (simulated refresh)
     const unsub1 = DB.subscribeLogs(setLogs);
     const unsub2 = DB.subscribeJobs(setJobs);
     return () => { unsub1(); unsub2(); };
   }, [refreshKey]);

   const getFilterDate = (type: 'week' | 'month' | 'year' | 'all') => {
       const now = new Date();
       if (type === 'all') return 0;
       
       const d = new Date();
       if (type === 'week') {
           // Start of current week (Monday)
           const day = now.getDay() || 7; 
           if (day !== 1) d.setHours(-24 * (day - 1));
           else d.setHours(0,0,0,0);
       } else if (type === 'month') {
           d.setDate(1);
       } else if (type === 'year') {
           d.setMonth(0, 1);
       }
       d.setHours(0,0,0,0);
       return d.getTime();
   };

   // Grouping and Filtering Logic
   const groupedLogs = useMemo(() => {
       const minDate = getFilterDate(timeFilter);
       const term = search.toLowerCase();
       
       // 1. Filter raw logs
       const filtered = logs.filter(l => {
           if (l.startTime < minDate) return false;
           if (!term) return true;
           
           // Search context: Log fields OR Job context
           const job = jobs.find(j => j.id === l.jobId);
           const jobStr = job ? JSON.stringify(job).toLowerCase() : '';
           
           return (
               l.jobId.toLowerCase().includes(term) ||
               l.userName.toLowerCase().includes(term) ||
               l.operation.toLowerCase().includes(term) ||
               jobStr.includes(term)
           );
       });

       // 2. Group by Job ID
       const groups: Record<string, { job: Job | undefined, logs: TimeLog[], totalMins: number, lastActive: number }> = {};
       
       filtered.forEach(l => {
           if (!groups[l.jobId]) {
               groups[l.jobId] = {
                   job: jobs.find(j => j.id === l.jobId),
                   logs: [],
                   totalMins: 0,
                   lastActive: 0
               };
           }
           groups[l.jobId].logs.push(l);
           groups[l.jobId].totalMins += (l.durationMinutes || 0);
           if (l.startTime > groups[l.jobId].lastActive) {
               groups[l.jobId].lastActive = l.startTime;
           }
       });

       // 3. Sort groups by most recently active
       return Object.values(groups).sort((a,b) => b.lastActive - a.lastActive);
   }, [logs, jobs, search, timeFilter]);

   const stats = useMemo(() => {
       // Re-calculate stats based on the GROUPS to ensure it matches view
       const totalMinutes = groupedLogs.reduce((acc, g) => acc + g.totalMins, 0);
       const totalRecords = groupedLogs.reduce((acc, g) => acc + g.logs.length, 0);
       return { totalMinutes, uniqueJobs: groupedLogs.length, count: totalRecords };
   }, [groupedLogs]);

   return (
      <div className="space-y-6">
         {/* HEADER */}
         <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
             <h2 className="text-2xl font-bold flex items-center gap-2"><Calendar className="w-6 h-6 text-blue-500" /> Work Logs</h2>
             
             <div className="flex gap-2 bg-zinc-900 border border-white/10 p-1 rounded-xl">
                 {(['week', 'month', 'year', 'all'] as const).map((t) => (
                     <button 
                        key={t}
                        onClick={() => setTimeFilter(t)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${timeFilter === t ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-white'}`}
                     >
                         {t === 'all' ? 'All Time' : `This ${t}`}
                     </button>
                 ))}
             </div>
         </div>

         {/* CONTROLS & SEARCH */}
         <div className="flex gap-2">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                <input 
                    value={search} 
                    onChange={e => setSearch(e.target.value)} 
                    placeholder="Filter by Job ID, PO, Part, or Employee..." 
                    className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none placeholder-zinc-600" 
                />
            </div>
            <button onClick={() => setRefreshKey(k => k + 1)} className="px-3 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Refresh">
                <RefreshCw className="w-4 h-4" />
            </button>
         </div>

         {/* SUMMARY AGGREGATION */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             <div className="bg-blue-600/10 border border-blue-600/20 p-4 rounded-2xl">
                 <p className="text-xs text-blue-400 font-bold uppercase mb-1 flex items-center gap-2"><Clock className="w-3 h-3"/> Total Hours</p>
                 <p className="text-2xl font-bold text-white">{formatDurationDecimal(stats.totalMinutes)} <span className="text-sm font-normal text-blue-300">hrs</span></p>
             </div>
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl">
                 <p className="text-xs text-zinc-500 font-bold uppercase mb-1">Total Records</p>
                 <p className="text-2xl font-bold text-white">{stats.count}</p>
             </div>
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl">
                 <p className="text-xs text-zinc-500 font-bold uppercase mb-1">Unique Jobs</p>
                 <p className="text-2xl font-bold text-white">{stats.uniqueJobs}</p>
             </div>
         </div>

         {/* GROUPED LOGS DISPLAY */}
         <div className="space-y-6">
             {groupedLogs.length === 0 && (
                <div className="p-12 text-center text-zinc-500 flex flex-col items-center justify-center bg-zinc-900/30 rounded-2xl border border-white/5">
                   <Search className="w-10 h-10 mb-2 opacity-20" />
                   No logs found matching your criteria.
                </div>
             )}

             {groupedLogs.map(group => (
                 <div key={group.job?.id || Math.random()} className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden shadow-sm hover:border-white/10 transition-colors">
                     {/* Job Header */}
                     <div className="bg-zinc-800/50 p-4 flex flex-col md:flex-row justify-between md:items-center gap-4 border-b border-white/5">
                         <div className="flex items-center gap-4">
                             <div className="bg-blue-500/20 p-3 rounded-xl">
                                 <Briefcase className="w-6 h-6 text-blue-400" />
                             </div>
                             <div>
                                 <h3 className="font-bold text-lg text-white">{group.job?.jobIdsDisplay || 'Unknown Job'}</h3>
                                 <div className="flex gap-3 text-xs text-zinc-400">
                                     <span className="font-mono bg-black/30 px-2 py-0.5 rounded">PO: {group.job?.poNumber || 'N/A'}</span>
                                     <span>Part: {group.job?.partNumber || 'N/A'}</span>
                                 </div>
                             </div>
                         </div>
                         <div className="flex items-center gap-4">
                             <div className="text-right">
                                 <p className="text-xs text-zinc-500 uppercase font-bold">Total Time</p>
                                 <p className="text-xl font-bold text-white font-mono">{formatDuration(group.totalMins)}</p>
                             </div>
                             <div className="h-8 w-[1px] bg-white/10"></div>
                             <div className="text-right">
                                <p className="text-xs text-zinc-500 uppercase font-bold">Records</p>
                                <p className="text-xl font-bold text-white">{group.logs.length}</p>
                             </div>
                         </div>
                     </div>

                     {/* Logs Table */}
                     <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                           <thead className="bg-white/5 text-zinc-500 text-xs uppercase font-bold tracking-wider">
                               <tr>
                                   <th className="px-6 py-3">Date</th>
                                   <th className="px-6 py-3">Time Range</th>
                                   <th className="px-6 py-3">Employee</th>
                                   <th className="px-6 py-3">Operation</th>
                                   <th className="px-6 py-3 text-right">Duration</th>
                               </tr>
                           </thead>
                           <tbody className="divide-y divide-white/5">
                               {group.logs.sort((a,b) => b.startTime - a.startTime).map(l => (
                                   <tr key={l.id} className="hover:bg-white/5 transition-colors group">
                                       <td className="px-6 py-3 text-zinc-400">{new Date(l.startTime).toLocaleDateString()}</td>
                                       <td className="px-6 py-3 font-mono text-zinc-500 text-xs">
                                           {new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                           <span className="mx-2 text-zinc-700">-</span>
                                           {l.endTime ? new Date(l.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '...'}
                                       </td>
                                       <td className="px-6 py-3 text-zinc-300">
                                           <div className="flex items-center gap-2">
                                              <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500 font-bold">{l.userName.charAt(0)}</div>
                                              {l.userName}
                                           </div>
                                       </td>
                                       <td className="px-6 py-3">
                                           <span className="bg-zinc-800 text-zinc-300 px-2 py-1 rounded text-xs border border-white/5 group-hover:bg-zinc-700 transition-colors">{l.operation}</span>
                                       </td>
                                       <td className="px-6 py-3 text-right font-mono">
                                            {l.endTime ? (
                                                <span className="text-zinc-300">{formatDuration(l.durationMinutes)}</span>
                                            ) : (
                                                <span className="text-emerald-400 font-bold text-xs animate-pulse flex items-center justify-end gap-1"><div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"/> RUNNING</span>
                                            )}
                                       </td>
                                   </tr>
                               ))}
                           </tbody>
                        </table>
                     </div>
                 </div>
             ))}
         </div>
      </div>
   )
}

// --- ADMIN: EMPLOYEES ---
const AdminEmployees = ({ addToast }: { addToast: any }) => {
   const [users, setUsers] = useState<User[]>([]);
   const [editingUser, setEditingUser] = useState<Partial<User>>({});
   const [showModal, setShowModal] = useState(false);

   useEffect(() => DB.subscribeUsers(setUsers), []);

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
              <button onClick={() => { setEditingUser(u); setShowModal(true); }} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white"><Edit2 className="w-4 h-4" /></button>
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
   const handleSave = () => { DB.saveSettings(settings); addToast('success', 'Settings Updated'); };
   return (
     <div className="max-w-xl space-y-6">
        <h2 className="text-2xl font-bold text-white">System Settings</h2>
        
        {/* DATABASE STATUS REMOVED */}
        {/* <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-4">
           ...
        </div> */}

        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 space-y-6">
           <div className="flex items-center gap-3 mb-6 pb-6 border-b border-white/5"><div className="bg-orange-500/20 p-2 rounded-lg text-orange-400"><Clock className="w-6 h-6" /></div><div><h3 className="font-bold text-white">Auto-Cleanup Rules</h3><p className="text-sm text-zinc-500">Automatically clock out forgotton timers.</p></div></div>
           <div className="space-y-4">
             <div className="flex items-center justify-between"><label className="text-sm text-zinc-300">Enable Auto-Clock Out</label><input type="checkbox" checked={settings.autoClockOutEnabled} onChange={e => setSettings({...settings, autoClockOutEnabled: e.target.checked})} className="w-5 h-5 rounded bg-zinc-800 border-white/10 text-blue-600 focus:ring-blue-500" /></div>
             <div><label className="text-xs text-zinc-500 block mb-1">Auto-Clock Out Time</label><input type="time" value={settings.autoClockOutTime} onChange={e => setSettings({...settings, autoClockOutTime: e.target.value})} className="w-full bg-zinc-950 border border-white/10 rounded-lg p-2 text-white" /></div>
           </div>
        </div>
        <div className="flex justify-end"><button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2"><Save className="w-5 h-5" /> Save Changes</button></div>
     </div>
   );
};

// --- APP ROOT ---
export default function App() {
  const [user, setUser] = useState<User | null>(() => { try { return JSON.parse(localStorage.getItem('nexus_user') || 'null'); } catch(e) { return null; } });
  const [view, setView] = useState<AppView>('login');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [printable, setPrintable] = useState<Job | null>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  // Deep Link Handling: Check URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jid = params.get('jobId');
    if (jid) {
        setPendingJobId(jid);
        // Clear param visually without reload, so it doesn't stay in URL if they navigate away
        window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => { 
      // User Persistence
      if(user) localStorage.setItem('nexus_user', JSON.stringify(user)); 
      else localStorage.removeItem('nexus_user'); 
      
      // View Routing
      if(!user) setView('login'); 
      else if(user.role === 'admin' && view === 'login') setView('admin-dashboard'); 
      else if(user.role === 'employee') setView('employee-scan');
  }, [user]);

  const addToast = (t: any, m: any) => setToasts(p => [...p, {id: Date.now().toString(), type: t, message: m}]);

  if (!user || view === 'login') return <><PrintStyles /><LoginView onLogin={setUser} addToast={addToast} /><div className="fixed bottom-4 right-4 z-50 pointer-events-none"><div className="pointer-events-auto">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div></>;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans">
       <PrintStyles />
       
       {/* New Modal-based Printer Component */}
       <PrintableJobSheet job={printable} onClose={() => setPrintable(null)} />
       
       <ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
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
          {view === 'admin-dashboard' && <AdminDashboard confirmAction={setConfirm} />}
          {view === 'admin-jobs' && <JobsView addToast={addToast} setPrintable={setPrintable} confirm={setConfirm} />}
          {view === 'admin-logs' && <LogsView />}
          {view === 'admin-team' && <AdminEmployees addToast={addToast} />}
          {view === 'admin-settings' && <SettingsView addToast={addToast} />}
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} initialJobId={pendingJobId} onConsumeInitialId={() => setPendingJobId(null)} />}
       </main>
       <div className="fixed bottom-6 right-6 z-50 pointer-events-none"><div className="pointer-events-auto flex flex-col items-end gap-2">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div>
    </div>
  );
}