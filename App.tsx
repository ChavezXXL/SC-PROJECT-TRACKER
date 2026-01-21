import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, Briefcase, Users, Settings, LogOut, Menu,
  Sparkles, Clock, CheckCircle, StopCircle,
  Search, Plus, User as UserIcon, Calendar, Edit2, Save, X,
  ArrowRight, Box, History, AlertCircle, ChevronDown, ChevronRight, Filter, Info,
  Printer, ScanLine, QrCode, Power, AlertTriangle, Trash2, Wifi, WifiOff,
  RotateCcw, ChevronUp, Database, ExternalLink
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

// --- PRINT STYLES ---
const PrintStyles = () => (
  <style>{`
    @media screen { #printable-area { position: fixed; left: -9999px; top: 0; } }
    @media print {
      body * { visibility: hidden; }
      #printable-area, #printable-area * { visibility: visible; }
      #printable-area { position: absolute; left: 0; top: 0; width: 100%; height: 100%; z-index: 9999; background: white; color: black; }
      @page { size: auto; margin: 0mm; }
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

// --- EMPLOYEE DASHBOARD ---
const EmployeeDashboard = ({ user, addToast, onLogout }: { user: User, addToast: any, onLogout: () => void }) => {
  const [tab, setTab] = useState<'jobs' | 'history' | 'scan'>('jobs');
  const [activeLog, setActiveLog] = useState<TimeLog | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [myHistory, setMyHistory] = useState<TimeLog[]>([]);

  useEffect(() => {
    const unsubLogs = DB.subscribeLogs((allLogs) => {
       const myActive = allLogs.find(l => l.userId === user.id && !l.endTime);
       const history = allLogs.filter(l => l.userId === user.id).sort((a,b) => b.startTime - a.startTime);
       setActiveLog(myActive || null);
       setMyHistory(history);
       if (myActive) DB.getJobById(myActive.jobId).then(j => setActiveJob(j || null));
       else setActiveJob(null);
    });
    const unsubJobs = DB.subscribeJobs((allJobs) => {
        setJobs(allJobs.filter(j => j.status !== 'completed').reverse());
    });
    return () => { unsubLogs(); unsubJobs(); };
  }, [user.id]);

  const handleStartJob = async (jobId: string, operation: string) => {
    try { await DB.startTimeLog(jobId, user.id, user.name, operation); addToast('success', 'Timer Started'); } 
    catch (e) { addToast('error', 'Failed to start timer'); }
  };

  const handleStopJob = async (logId: string) => {
    try { await DB.stopTimeLog(logId); addToast('success', 'Job Stopped'); } 
    catch (e) { addToast('error', 'Failed to stop. Please try again.'); }
  };

  const handleScan = (e: any) => {
      if (e.key === 'Enter') {
          const val = e.currentTarget.value;
          setSearch(val); setTab('jobs'); addToast('success', 'Scanned');
      }
  }

  const filteredJobs = jobs.filter(j => JSON.stringify(j).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col pb-20">
      {activeLog && <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} />}
      <div className="flex flex-wrap gap-2 justify-between items-center bg-zinc-900/50 backdrop-blur-md p-2 rounded-2xl border border-white/5">
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
               <input autoFocus onKeyDown={handleScan} className="bg-black/50 border border-blue-500 rounded-xl px-4 py-3 text-white text-center w-full text-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Scan Code..." />
               <p className="text-zinc-500 text-xs mt-4">Point scanner at QR code or type ID manually.</p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredJobs.map(job => (<JobSelectionCard key={job.id} job={job} onStart={handleStartJob} disabled={!!activeLog} />))}
            {filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found.</div>}
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

// --- DATABASE CONFIG MODAL (Kept for future use, but not rendered) ---
const DatabaseConfigModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [configStr, setConfigStr] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
     try {
         let jsonStr = configStr.trim();
         if (jsonStr.indexOf('=') > -1) {
             jsonStr = jsonStr.split('=')[1].trim();
             if (jsonStr.endsWith(';')) jsonStr = jsonStr.slice(0, -1);
         }
         if (!jsonStr.startsWith('{') && !jsonStr.includes('"apiKey"')) {
             throw new Error("Please paste the JSON object from Firebase.");
         }
         const apiKey = jsonStr.match(/apiKey:\s*["']([^"']+)["']/)?.[1];
         const projectId = jsonStr.match(/projectId:\s*["']([^"']+)["']/)?.[1];
         let configToSave;
         if (apiKey && projectId) {
             configToSave = {
                 apiKey,
                 projectId,
                 authDomain: jsonStr.match(/authDomain:\s*["']([^"']+)["']/)?.[1] || "",
                 storageBucket: jsonStr.match(/storageBucket:\s*["']([^"']+)["']/)?.[1] || "",
                 messagingSenderId: jsonStr.match(/messagingSenderId:\s*["']([^"']+)["']/)?.[1] || "",
                 appId: jsonStr.match(/appId:\s*["']([^"']+)["']/)?.[1] || ""
             };
         } else {
             configToSave = JSON.parse(jsonStr);
         }
         DB.saveFirebaseConfig(configToSave);
         onClose();
     } catch(e) {
         setError("Invalid Config. Make sure to copy the 'firebaseConfig' object.");
     }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2"><Database className="text-blue-500" /> Connect Database</h3>
        <p className="text-zinc-400 text-sm mb-4">
           Go to Firebase Console &gt; Project Settings. Scroll down to "Your apps". Select "Web" (&lt;/&gt;) to create an app, then copy the <code>firebaseConfig</code> object and paste it here.
        </p>
        <textarea 
           value={configStr}
           onChange={e => { setConfigStr(e.target.value); setError(''); }}
           className="w-full bg-black/50 border border-white/10 rounded-xl p-4 font-mono text-xs text-green-400 h-40 focus:ring-2 focus:ring-blue-500 outline-none"
           placeholder={`const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n  ...\n};`}
        />
        {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm">Cancel</button>
          <button onClick={handleSave} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-blue-900/20">Save & Connect</button>
        </div>
      </div>
    </div>
  );
};

// --- PRINTABLE JOB SHEET ---
const PrintableJobSheet = ({ job }: { job: Job | null }) => {
  if (!job) return null;
  const qrData = JSON.stringify({ id: job.id });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;

  return (
    <div id="printable-area" className="p-8 box-border">
      <div className="border-4 border-black h-full p-8 flex flex-col">
        <div className="flex justify-between border-b-4 border-black pb-6 mb-8">
          <div><h1 className="text-6xl font-black mb-2">{job.poNumber}</h1><p className="text-xl uppercase tracking-widest">Job Traveler</p></div>
          <div className="text-right"><h2 className="text-3xl font-mono font-bold">{job.jobIdsDisplay}</h2></div>
        </div>
        <div className="grid grid-cols-3 gap-8 mb-8">
           <div className="col-span-2 border-2 border-black p-4">
              <div className="grid grid-cols-2 gap-4">
                  <div><span className="block text-xs uppercase font-bold text-gray-500">Part</span><span className="text-4xl font-black">{job.partNumber}</span></div>
                  <div><span className="block text-xs uppercase font-bold text-gray-500">Qty</span><span className="text-4xl font-black">{job.quantity}</span></div>
              </div>
              <div className="mt-4 pt-4 border-t-2 border-black">
                 <span className="block text-xs uppercase font-bold text-gray-500">Notes</span>
                 <p className="text-lg font-serif">{job.info || "No notes."}</p>
              </div>
           </div>
           <div className="border-2 border-black p-4 flex flex-col items-center justify-center">
              <img src={qrUrl} alt="QR" className="w-40 h-40 mb-2" />
              <span className="text-lg font-black tracking-widest">SCAN ME</span>
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
  
  // NOTE: removed explicit database config UI to prevent confusion in sandbox environments.
  
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
    } catch (e) {
      addToast('error', 'Login Error');
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
        
        {/* DATABASE STATUS REMOVED AS REQUESTED */}

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
   const [activeTab, setActiveTab] = useState<'active'|'history'>('active');
   const [jobs, setJobs] = useState<Job[]>([]);
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [showModal, setShowModal] = useState(false);
   const [editingJob, setEditingJob] = useState<Partial<Job>>({});
   const [aiLoading, setAiLoading] = useState(false);
   const [isSaving, setIsSaving] = useState(false);
   const [search, setSearch] = useState('');

   useEffect(() => {
       const u1 = DB.subscribeJobs(setJobs);
       const u2 = DB.subscribeLogs(setLogs);
       return () => { u1(); u2(); };
   }, []);

   const handleDelete = (id: string) => confirm({ title: "Delete", message: "Delete job?", onConfirm: () => DB.deleteJob(id) });
   const handleComplete = (id: string) => confirm({ title: "Complete Job", message: "Mark this job as done? It will move to history.", onConfirm: () => DB.completeJob(id) });
   const handleReopen = (id: string) => confirm({ title: "Reopen Job", message: "Move back to active jobs?", onConfirm: () => DB.reopenJob(id) });

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

   const filteredJobs = jobs.filter(j => {
       const matchesSearch = JSON.stringify(j).toLowerCase().includes(search.toLowerCase());
       if (activeTab === 'active') return matchesSearch && j.status !== 'completed';
       return matchesSearch && j.status === 'completed';
   }).sort((a,b) => (b.completedAt || 0) - (a.completedAt || 0));

   const getJobStats = (jobId: string) => {
       const jobLogs = logs.filter(l => l.jobId === jobId);
       const totalMins = jobLogs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
       const users: string[] = Array.from(new Set(jobLogs.map(l => l.userName)));
       return { totalMins, users };
   };

   return (
      <div className="space-y-6">
         <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <h2 className="text-2xl font-bold">Job Management</h2>
            <div className="flex gap-2">
               <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder={activeTab === 'active' ? "Search Active Jobs..." : "Search Job History..."} className="pl-9 pr-4 py-2 bg-zinc-900 border border-white/10 rounded-xl text-sm text-white w-64 focus:ring-2 focus:ring-blue-500 outline-none"/>
               </div>
               <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center gap-2 hover:bg-blue-500"><Plus className="w-4 h-4"/> New Job</button>
            </div>
         </div>

         <div className="flex gap-4 border-b border-white/5">
             <button onClick={() => setActiveTab('active')} className={`pb-3 px-1 text-sm font-bold transition-all ${activeTab === 'active' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-zinc-500 hover:text-white'}`}>Active Production</button>
             <button onClick={() => setActiveTab('history')} className={`pb-3 px-1 text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'history' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-zinc-500 hover:text-white'}`}><History className="w-4 h-4"/> History / Completed</button>
         </div>
         
         {activeTab === 'active' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-fade-in">
                {filteredJobs.map(j => (
                <div key={j.id} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 hover:bg-zinc-900 transition-all flex flex-col group relative overflow-hidden">
                    <div className="flex justify-between items-start mb-3 relative z-10">
                        <div>
                            <h3 className="text-white font-bold text-lg">{j.jobIdsDisplay}</h3>
                            <p className="text-blue-400 text-sm font-mono">{j.poNumber}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded font-bold uppercase tracking-wide ${j.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400 animate-pulse' : 'bg-zinc-800 text-zinc-500'}`}>{j.status}</span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-sm text-zinc-400 mb-4 relative z-10">
                        <div>Part: <span className="text-zinc-200">{j.partNumber}</span></div>
                        <div>Qty: <span className="text-zinc-200">{j.quantity}</span></div>
                        <div>Due: <span className="text-zinc-200">{j.dueDate || 'N/A'}</span></div>
                    </div>

                    <div className="mt-auto pt-4 border-t border-white/5 flex justify-end gap-2 relative z-10">
                        <button onClick={() => handleComplete(j.id)} className="px-3 py-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"><CheckCircle className="w-3 h-3"/> Complete</button>
                        <button onClick={() => setPrintable(j)} className="p-2 bg-zinc-800 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700" title="Print"><Printer className="w-4 h-4"/></button>
                        <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 bg-zinc-800 rounded-lg text-blue-400 hover:text-white hover:bg-blue-600" title="Edit"><Edit2 className="w-4 h-4"/></button>
                        <button onClick={() => handleDelete(j.id)} className="p-2 bg-zinc-800 rounded-lg text-red-400 hover:text-white hover:bg-red-600" title="Delete"><Trash2 className="w-4 h-4"/></button>
                    </div>
                </div>
                ))}
                {filteredJobs.length === 0 && <div className="col-span-full py-12 text-center text-zinc-500">No active jobs found.</div>}
            </div>
         ) : (
             <div className="space-y-4 animate-fade-in">
                 {filteredJobs.map(j => {
                     const stats = getJobStats(j.id);
                     return (
                        <div key={j.id} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6 flex flex-col md:flex-row gap-6 items-center hover:bg-zinc-900 transition-colors">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <h3 className="text-xl font-bold text-white">{j.poNumber}</h3>
                                    <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold uppercase">Completed</span>
                                    {j.completedAt && <span className="text-zinc-500 text-xs">{new Date(j.completedAt).toLocaleDateString()}</span>}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-zinc-400">
                                    <div>Job ID: <span className="text-zinc-200">{j.jobIdsDisplay}</span></div>
                                    <div>Part: <span className="text-zinc-200">{j.partNumber}</span></div>
                                    <div>Qty: <span className="text-zinc-200">{j.quantity}</span></div>
                                </div>
                            </div>
                            
                            <div className="flex gap-8 border-l border-white/5 pl-6">
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase font-bold">Total Hours</p>
                                    <p className="text-2xl font-mono text-white font-bold">{formatDuration(stats.totalMins)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-zinc-500 uppercase font-bold">Team</p>
                                    <div className="flex -space-x-2 mt-1">
                                        {stats.users.map((u, i) => (
                                            <div key={i} className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-900 flex items-center justify-center text-xs text-zinc-400" title={u}>
                                                {u.charAt(0)}
                                            </div>
                                        ))}
                                        {stats.users.length === 0 && <span className="text-zinc-600 text-sm italic">None</span>}
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button onClick={() => handleReopen(j.id)} className="p-3 bg-zinc-800 hover:bg-blue-600 text-zinc-400 hover:text-white rounded-xl transition-colors" title="Reopen Job"><RotateCcw className="w-5 h-5"/></button>
                                <button onClick={() => handleDelete(j.id)} className="p-3 bg-zinc-800 hover:bg-red-600 text-zinc-400 hover:text-white rounded-xl transition-colors" title="Delete History"><Trash2 className="w-5 h-5"/></button>
                            </div>
                        </div>
                     );
                 })}
                 {filteredJobs.length === 0 && <div className="py-12 text-center text-zinc-500">No job history found matching your search.</div>}
             </div>
         )}

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
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Job ID(s)</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.jobIdsDisplay || ''} onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} /></div>
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Part Number</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.partNumber || ''} onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">PO Number</label><input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.poNumber || ''} onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} /></div>
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Quantity</label><input type="number" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.quantity || ''} onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Date Received</label><input type="date" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.dateReceived || ''} onChange={e => setEditingJob({...editingJob, dateReceived: e.target.value})} /></div>
                <div><label className="text-xs text-zinc-500 ml-1 mb-1 block">Due Date</label><input type="date" className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-white" value={editingJob.dueDate || ''} onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} /></div>
              </div>
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

// --- ADMIN: LOGS (REVAMPED GROUPING + FILTERS) ---
const LogsView = () => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

   // Filters State
   const [search, setSearch] = useState('');
   const [timeFilter, setTimeFilter] = useState<'all' | 'week' | 'month' | 'year'>('all');
   const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');

   useEffect(() => {
     const u1 = DB.subscribeLogs(setLogs);
     const u2 = DB.subscribeJobs(setJobs);
     return () => { u1(); u2(); };
   }, []);

   const jobMap = useMemo(() => {
      const map: Record<string, Job> = {};
      jobs.forEach(j => map[j.id] = j);
      return map;
   }, [jobs]);

   const toggleGroup = (key: string) => setExpandedGroups(prev => ({...prev, [key]: !prev[key]}));

   // 1. FILTER LOGIC
   const filteredLogs = useMemo(() => {
      let filtered = logs;

      // Time Filter
      const now = new Date();
      if (timeFilter !== 'all') {
          const start = new Date(now);
          start.setHours(0,0,0,0);
          if (timeFilter === 'week') { start.setDate(now.getDate() - now.getDay()); }
          else if (timeFilter === 'month') { start.setDate(1); }
          else if (timeFilter === 'year') { start.setMonth(0, 1); }
          filtered = filtered.filter(l => l.startTime >= start.getTime());
      }

      // Status Filter
      if (statusFilter !== 'all') {
          filtered = filtered.filter(l => {
              const j = jobMap[l.jobId];
              if (!j) return false;
              if (statusFilter === 'active') return j.status !== 'completed';
              return j.status === 'completed';
          });
      }

      // Search Filter
      if (search.trim()) {
          const s = search.toLowerCase();
          filtered = filtered.filter(l => {
              const j = jobMap[l.jobId];
              return (
                  l.userName.toLowerCase().includes(s) ||
                  (j && j.jobIdsDisplay.toLowerCase().includes(s)) ||
                  (j && j.poNumber.toLowerCase().includes(s))
              );
          });
      }

      return filtered;
   }, [logs, jobMap, timeFilter, statusFilter, search]);

   // 2. GROUPING LOGIC (Applied to filtered logs)
   const groupedData = useMemo(() => {
      const groups: Record<string, { key: string, label: string, subLabel: string, logs: TimeLog[], totalMins: number, isCompleted: boolean }> = {};

      filteredLogs.forEach(log => {
         const j = jobMap[log.jobId];
         const key = log.jobId;
         const label = j ? `${j.poNumber}` : 'Unknown Job';
         const subLabel = j ? j.jobIdsDisplay : 'Job Deleted';

         if (!groups[key]) groups[key] = { key, label, subLabel, logs: [], totalMins: 0, isCompleted: j?.status === 'completed' };
         groups[key].logs.push(log);
         groups[key].totalMins += (log.durationMinutes || 0);
      });

      return Object.values(groups).sort((a,b) => {
          const lastA = Math.max(...a.logs.map(l => l.startTime));
          const lastB = Math.max(...b.logs.map(l => l.startTime));
          return lastB - lastA;
      });
   }, [filteredLogs, jobMap]);

   return (
      <div className="space-y-6">
         <div className="flex flex-col gap-4">
             <h2 className="text-2xl font-bold text-white">Production Logs</h2>
             
             {/* FILTERS BAR */}
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center">
                <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Logs..." className="w-full bg-zinc-950 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                
                <div className="flex bg-zinc-950 rounded-xl p-1 border border-white/10 overflow-x-auto max-w-full">
                    {[
                        {id: 'all', l: 'All Time'}, 
                        {id: 'week', l: 'This Week'}, 
                        {id: 'month', l: 'This Month'}, 
                        {id: 'year', l: 'This Year'}
                    ].map(f => (
                        <button key={f.id} onClick={() => setTimeFilter(f.id as any)} className={`px-4 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${timeFilter === f.id ? 'bg-blue-600 text-white' : 'text-zinc-500 hover:text-white'}`}>{f.l}</button>
                    ))}
                </div>

                <div className="flex bg-zinc-950 rounded-xl p-1 border border-white/10">
                    {[
                        {id: 'all', l: 'All Jobs'}, 
                        {id: 'active', l: 'Active'}, 
                        {id: 'completed', l: 'Completed'}
                    ].map(f => (
                        <button key={f.id} onClick={() => setStatusFilter(f.id as any)} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${statusFilter === f.id ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-white'}`}>{f.l}</button>
                    ))}
                </div>
             </div>
         </div>

         <div className="space-y-4">
             {groupedData.map(group => {
                 const isOpen = expandedGroups[group.key];
                 return (
                    <div key={group.key} className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden transition-all">
                       <div 
                          onClick={() => toggleGroup(group.key)}
                          className="p-4 bg-white/5 hover:bg-white/10 cursor-pointer flex items-center justify-between"
                       >
                          <div className="flex items-center gap-4">
                             <div className={`p-1 rounded-full ${isOpen ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                                {isOpen ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                             </div>
                             <div>
                                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                    {group.label} 
                                    <span className="text-zinc-500 text-sm font-normal">| {group.subLabel}</span>
                                    {group.isCompleted && <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded uppercase font-bold">Done</span>}
                                </h3>
                                <p className="text-xs text-zinc-500">{group.logs.length} logs recorded in selection</p>
                             </div>
                          </div>
                          <div className="text-right">
                             <div className="text-xl font-bold text-white font-mono">{formatDuration(group.totalMins)}</div>
                             <div className="text-xs text-zinc-500">Total Selection Time</div>
                          </div>
                       </div>
                       
                       {isOpen && (
                          <div className="border-t border-white/5 animate-fade-in">
                             <table className="w-full text-sm text-left">
                                <thead className="text-zinc-500 text-xs bg-black/20"><tr><th className="p-3 pl-12">Date</th><th className="p-3">User</th><th className="p-3">Operation</th><th className="p-3 text-right">Time</th></tr></thead>
                                <tbody className="divide-y divide-white/5">
                                   {group.logs.sort((a,b) => b.startTime - a.startTime).map(l => (
                                      <tr key={l.id} className="hover:bg-white/5">
                                         <td className="p-3 pl-12 text-zinc-400">
                                            {new Date(l.startTime).toLocaleDateString()} <span className="text-xs opacity-50 ml-1">{new Date(l.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                         </td>
                                         <td className="p-3 text-white">{l.userName}</td>
                                         <td className="p-3 text-blue-400">{l.operation}</td>
                                         <td className="p-3 text-right font-mono text-zinc-300">
                                            {l.endTime ? formatDuration(l.durationMinutes) : <span className="text-emerald-500 text-xs font-bold">RUNNING</span>}
                                         </td>
                                      </tr>
                                   ))}
                                </tbody>
                             </table>
                          </div>
                       )}
                    </div>
                 );
             })}
             {groupedData.length === 0 && <div className="p-12 text-center text-zinc-500 border border-white/5 rounded-2xl border-dashed">No logs found matching your filters.</div>}
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
       <PrintStyles /><PrintableJobSheet job={printable} /><ConfirmationModal isOpen={!!confirm} {...confirm} onCancel={() => setConfirm(null)} />
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
          {view === 'employee-scan' && <EmployeeDashboard user={user} addToast={addToast} onLogout={() => setUser(null)} />}
       </main>
       <div className="fixed bottom-6 right-6 z-50 pointer-events-none"><div className="pointer-events-auto flex flex-col items-end gap-2">{toasts.map(t => <Toast key={t.id} toast={t} onClose={id => setToasts(p => p.filter(x => x.id !== id))} />)}</div></div>
    </div>
  );
}