import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  Settings,
  LogOut,
  Sparkles,
  Clock,
  CheckCircle,
  StopCircle,
  Search,
  Plus,
  User as UserIcon,
  Calendar,
  Edit2,
  Save,
  X,
  History,
  AlertTriangle,
  AlertCircle,
  Info,
  Printer,
  ScanLine,
  QrCode,
  Power,
  Trash2,
  Activity,
  Play,
  RefreshCw,
  Filter,
  EyeOff,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  BarChart3,
  TrendingUp,
  Hash
} from "lucide-react";

import { Toast } from "./components/Toast";
import { Job, User, TimeLog, ToastMessage, AppView, SystemSettings, JobPriority, JobStatus } from "./types";
import * as DB from "./services/mockDb";
import { parseJobDetails } from "./services/geminiService";

// Local QR generator
import QRCodeLib from "https://esm.sh/qrcode@1.5.3";

// --------------------
// UTILS
// --------------------
const formatDuration = (mins: number | undefined) => {
  if (mins === undefined || mins === null) return "Running...";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const getDates = () => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())).setHours(0,0,0,0);
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
    return { startOfDay, startOfWeek, startOfMonth, startOfYear };
};

const toDateTimeLocal = (ts: number | undefined | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const safeBaseUrl = () => {
  const { origin, pathname } = window.location;
  return origin + pathname;
};

// --------------------
// ERROR BOUNDARY
// --------------------
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message?: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: err?.message || String(err) };
  }
  componentDidCatch(err: any) {
    console.error("App crashed:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 flex items-center justify-center">
          <div className="max-w-xl w-full bg-zinc-900/60 border border-red-500/30 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="w-6 h-6 text-red-400" />
              <h1 className="text-xl font-black">System Error</h1>
            </div>
            <p className="text-zinc-300 text-sm mb-4">
              The application encountered an error.
            </p>
            <pre className="text-xs bg-black/40 border border-white/10 rounded-xl p-4 overflow-auto">
              {this.state.message}
            </pre>
            <button 
              onClick={() => window.location.reload()} 
              className="mt-4 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children as any;
  }
}

// --------------------
// PRINT STYLES
// --------------------
const PrintStyles = () => (
  <style>{`
    @media print {
      body { margin: 0; padding: 0; background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body * { visibility: hidden !important; }
      #printable-area, #printable-area * { visibility: visible !important; }
      #printable-area {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        z-index: 99999 !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .no-print { display: none !important; }
      @page { size: portrait; margin: 0mm; }
    }
  `}</style>
);

// --------------------
// COMPONENTS
// --------------------
const Badge = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${className}`}>
    {children}
  </span>
);

const StatusBadge = ({ status }: { status: JobStatus }) => {
  switch (status) {
    case 'in-progress': return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> In Progress</Badge>;
    case 'completed': return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Completed</Badge>;
    case 'hold': return <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20">On Hold</Badge>;
    default: return <Badge className="bg-zinc-800 text-zinc-500 border-white/5">Pending</Badge>;
  }
};

const PriorityBadge = ({ priority }: { priority?: JobPriority }) => {
  switch (priority) {
    case 'urgent': return <Badge className="bg-red-500 text-white border-red-600 shadow-sm shadow-red-900/50">Urgent</Badge>;
    case 'high': return <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/20">High</Badge>;
    case 'low': return <Badge className="bg-zinc-800 text-zinc-500 border-white/5">Low</Badge>;
    default: return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">Normal</Badge>;
  }
};

const LiveTimer = ({ startTime }: { startTime: number }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(i);
  }, [startTime]);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return (
    <span className="tabular-nums font-mono">
      {h.toString().padStart(2, "0")}:{m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}
    </span>
  );
};

const ActiveJobPanel = ({ job, log, onStop, isAdmin }: { job: Job | null, log: TimeLog, onStop: (id: string) => Promise<void>, isAdmin: boolean }) => {
  const [isStopping, setIsStopping] = useState(false);
  
  return (
    <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-blue-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden animate-fade-in mb-8 no-print group">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>
      <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:opacity-10 transition-opacity duration-500"><Activity className="w-64 h-64 text-blue-500" /></div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
        <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
                <span className="flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <span className="text-red-400 font-bold uppercase tracking-widest text-xs">Active Job in Progress</span>
            </div>
            {/* Swapped display: PO is now primary */}
            <h2 className="text-5xl font-black text-white mb-2 tracking-tighter">{job ? job.poNumber : 'Unknown PO'}</h2>
            <div className="text-xl text-zinc-400 font-medium mb-6 flex items-center gap-3">
               <span className="bg-zinc-800 text-zinc-300 px-2 py-1 rounded text-sm font-mono">{job?.jobIdsDisplay}</span> 
               <span>{job?.partNumber}</span>
            </div>

            <div className="flex flex-wrap gap-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 min-w-[140px]">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide font-bold mb-1">Current Op</p>
                    <div className="text-blue-400 font-bold text-lg flex items-center gap-2">
                        <Settings className="w-4 h-4" /> {log.operation}
                    </div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 min-w-[140px]">
                    <p className="text-xs text-zinc-500 uppercase tracking-wide font-bold mb-1">Elapsed</p>
                    <div className="text-white font-mono text-2xl font-bold leading-none">
                        <LiveTimer startTime={log.startTime} />
                    </div>
                </div>
            </div>
        </div>

        <div className="flex items-center justify-center md:justify-end">
            <button 
                onClick={() => { setIsStopping(true); onStop(log.id).finally(() => setIsStopping(false)); }} 
                disabled={isStopping}
                className="w-full md:w-auto bg-red-600 hover:bg-red-500 text-white px-8 py-6 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 shadow-xl shadow-red-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
                {isStopping ? <RefreshCw className="w-6 h-6 animate-spin" /> : <StopCircle className="w-8 h-8" />}
                <span>Stop Timer</span>
            </button>
        </div>
      </div>
    </div>
  );
};

const JobSelectionCard: React.FC<{ job: Job, onStart: (id: string, op: string) => void, disabled?: boolean, operations: string[] }> = ({ job, onStart, disabled, operations }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden transition-all duration-300 ${expanded ? 'ring-2 ring-blue-500/50 bg-zinc-800' : 'hover:bg-zinc-800/50'} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div 
        className="p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-start mb-2">
          {/* PO Number Priority */}
          <h3 className="text-2xl font-black text-white tracking-tight">{job.poNumber}</h3>
          <span className="bg-zinc-950 text-zinc-400 text-xs px-2 py-1 rounded font-mono">{job.quantity} units</span>
        </div>
        <div className="text-sm text-zinc-500 space-y-1">
          <p className="flex items-center gap-2"><Hash className="w-3 h-3"/> ID: <span className="text-zinc-300 font-mono">{job.jobIdsDisplay}</span></p>
          <p>Part: <span className="text-zinc-300 font-bold">{job.partNumber}</span></p>
        </div>
        
        {!expanded && (
          <div className="mt-4 flex items-center text-blue-400 text-xs font-bold uppercase tracking-wide">
            Tap to Start <ChevronRight className="w-3 h-3 ml-1" />
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
                className="bg-zinc-800 hover:bg-blue-600 hover:text-white border border-white/5 py-2 px-3 rounded-lg text-sm text-zinc-300 transition-colors font-bold"
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

// --- PRINTABLE TRAVELER ---
const PrintableJobSheet = ({ job, onClose, isAdmin }: { job: Job | null; onClose: () => void; isAdmin: boolean }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    if (!job) return;
    const run = async () => {
      const jobUrl = `${safeBaseUrl()}?jobId=${encodeURIComponent(job.id)}`;
      try {
        const dataUrl = await (QRCodeLib as any).toDataURL(jobUrl, { width: 1024, margin: 0 });
        setQrDataUrl(dataUrl);
      } catch (e) {}
    };
    run();
  }, [job?.id]);

  if (!job) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/95 backdrop-blur-sm p-4 animate-fade-in overflow-y-auto">
      <div className="bg-white text-black w-full max-w-[1000px] h-[95vh] rounded-2xl shadow-2xl relative overflow-hidden flex flex-col">
        {/* Toolbar */}
        <div className="bg-zinc-900 text-white p-4 flex justify-between items-center no-print shrink-0 border-b border-zinc-800">
          <div>
            <h3 className="font-bold flex items-center gap-2 text-lg"><Printer className="w-5 h-5 text-blue-500" /> Print Preview</h3>
            {!isAdmin && <p className="text-xs text-red-400 flex items-center gap-1"><EyeOff className="w-3 h-3"/> Client info hidden from print</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-bold">Close</button>
            <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2"><Printer className="w-4 h-4" /> Print</button>
          </div>
        </div>

        {/* Paper Area */}
        <div id="printable-area" className="flex-1 bg-white flex flex-col p-[12mm] h-full overflow-y-auto">
           {/* Header */}
           <div className="flex justify-between items-start border-b-[6px] border-black pb-6 mb-8">
              <div>
                  <h1 className="text-6xl font-black uppercase tracking-tighter leading-none">SC DEBURRING</h1>
                  <p className="text-xl font-bold uppercase tracking-[0.3em] text-zinc-500 mt-2">Production Traveler</p>
              </div>
              <div className="text-right">
                  <div className="text-6xl font-black">{job.poNumber}</div>
                  <div className="text-sm font-bold text-zinc-400 uppercase mt-1">Purchase Order #</div>
              </div>
           </div>

           <div className="flex-1 grid grid-cols-3 gap-8">
               <div className="col-span-2 space-y-8">
                   <div className="border-[4px] border-black p-6 relative">
                       <label className="block text-xs uppercase font-black text-zinc-400 mb-2 tracking-widest">Internal Job ID</label>
                       <div className="text-4xl font-black leading-none">{job.jobIdsDisplay}</div>
                       <div className="mt-4 pt-4 border-t-2 border-zinc-100">
                           <label className="block text-xs uppercase font-black text-zinc-400 mb-1">Customer</label>
                           {isAdmin ? (
                              <div className="text-2xl font-bold">{job.customer || 'Internal Stock'}</div>
                           ) : (
                              <div className="text-2xl font-bold text-zinc-300 italic">RESTRICTED</div>
                           )}
                       </div>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-6">
                       <div className="bg-zinc-100 p-4 border-l-[8px] border-zinc-800">
                           <label className="block text-xs uppercase font-black text-zinc-400 mb-1">Part Number</label>
                           <div className="text-4xl font-bold break-all leading-tight">{job.partNumber}</div>
                       </div>
                       <div className="bg-zinc-100 p-4 border-l-[8px] border-zinc-800">
                           <label className="block text-xs uppercase font-black text-zinc-400 mb-1">Quantity</label>
                           <div className="text-5xl font-black">{job.quantity}</div>
                       </div>
                   </div>

                   <div className="grid grid-cols-2 gap-6">
                       <div className="p-4 border-[2px] border-zinc-200">
                           <label className="block text-xs uppercase font-black text-zinc-400 mb-1">Date In</label>
                           <div className="text-xl font-bold">{job.dateReceived}</div>
                       </div>
                       <div className="p-4 border-[2px] border-zinc-200">
                           <label className="block text-xs uppercase font-black text-zinc-400 mb-1">Due Date</label>
                           <div className="text-2xl font-black text-red-600">{job.dueDate || 'ASAP'}</div>
                       </div>
                   </div>
                   
                   <div className="mt-8">
                       <label className="block text-sm uppercase font-black text-zinc-400 mb-2 tracking-widest">Notes & Operations</label>
                       <div className="w-full min-h-[150px] border-[2px] border-zinc-300 border-dashed p-6 text-xl leading-relaxed font-medium bg-zinc-50">
                           {job.info || "No specific instructions provided."}
                       </div>
                   </div>
               </div>

               <div className="col-span-1 flex flex-col">
                   <div className="bg-zinc-900 text-white p-8 flex flex-col items-center justify-center text-center h-full max-h-[500px]">
                       {qrDataUrl && <img src={qrDataUrl} className="w-full h-auto bg-white p-2 mb-6" alt="QR" />}
                       <p className="text-zinc-500 font-mono text-xs mb-2">{job.id}</p>
                       <p className="text-2xl font-black uppercase tracking-widest">SCAN TO TRACK</p>
                   </div>
                   <div className="mt-auto pt-8">
                       <div className="flex justify-between border-b-2 border-zinc-200 py-2">
                           <span className="text-xs uppercase font-bold text-zinc-400">Priority</span>
                           <span className="font-black uppercase">{job.priority || 'Normal'}</span>
                       </div>
                   </div>
               </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const LoginView = ({ onLogin, addToast }: { onLogin: (u: User) => void; addToast: any }) => {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = await DB.loginUser(username, pin);
      if (user) { onLogin(user); addToast("success", `Welcome, ${user.name}`); }
      else { addToast("error", "Invalid Credentials"); setPin(""); }
    } catch (e: any) { addToast("error", "Login Error"); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6 relative">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
      <div className="w-full max-w-sm bg-zinc-900/80 backdrop-blur-xl border border-white/10 p-10 rounded-3xl shadow-2xl relative z-10">
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-black text-center text-white tracking-tight mb-2">SC DEBURRING</h1>
        <p className="text-center text-zinc-500 text-sm mb-8 font-medium uppercase tracking-widest">Production Portal</p>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" autoFocus />
          </div>
          <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase ml-1">PIN Code</label>
              <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-xl font-bold transition-all shadow-lg shadow-blue-900/20 mt-4 active:scale-95">Sign In</button>
        </form>
      </div>
    </div>
  );
};

const AdminDashboard = ({ user, setView, confirmAction }: any) => {
    const [stats, setStats] = useState({ active: 0, wip: 0, completedToday: 0, overdue: 0 });
    const [recentLogs, setRecentLogs] = useState<TimeLog[]>([]);
    const [activeLogs, setActiveLogs] = useState<TimeLog[]>([]);

    useEffect(() => {
        const u0 = DB.subscribeActiveLogs(setActiveLogs);
        const u1 = DB.subscribeJobs(jobs => {
            const today = new Date().toISOString().split('T')[0];
            setStats({
                active: jobs.filter(j => j.status === 'in-progress').length,
                wip: jobs.filter(j => j.status !== 'completed').length,
                completedToday: jobs.filter(j => j.status === 'completed' && j.completedAt && new Date(j.completedAt).toISOString().startsWith(today)).length,
                overdue: jobs.filter(j => j.status !== 'completed' && j.dueDate && j.dueDate < today).length
            });
        });
        const u2 = DB.subscribeLogs(logs => setRecentLogs(logs.slice(0,6)));
        return () => { u0(); u1(); u2(); };
    }, []);

    const StatCard = ({ label, value, icon: Icon, color, subtext }: any) => (
        <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl relative overflow-hidden group hover:border-white/10 transition-colors">
            <div className={`absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity ${color}`}><Icon className="w-16 h-16" /></div>
            <div className="relative z-10">
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-2">{label}</p>
                <h3 className="text-4xl font-black text-white">{value}</h3>
                {subtext && <p className={`text-xs mt-2 font-medium ${color.replace('text-', 'text-opacity-80 text-')}`}>{subtext}</p>}
            </div>
        </div>
    );

    const myLog = activeLogs.find(l => l.userId === user.id);
    const [myJob, setMyJob] = useState<Job | null>(null);
    useEffect(() => {
        if(myLog) DB.getJobById(myLog.jobId).then(setMyJob);
    }, [myLog]);

    return (
        <div className="space-y-8 animate-fade-in">
             {myLog && <ActiveJobPanel job={myJob} log={myLog} onStop={(id) => DB.stopTimeLog(id)} isAdmin={user.role === 'admin'} />}
             
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Active Now" value={stats.active} icon={Activity} color="text-blue-500" subtext="Jobs running on floor" />
                <StatCard label="Open Jobs" value={stats.wip} icon={Briefcase} color="text-zinc-400" subtext="Total in queue" />
                <StatCard label="Finished Today" value={stats.completedToday} icon={CheckCircle} color="text-emerald-500" subtext="Units processed" />
                <StatCard label="Overdue" value={stats.overdue} icon={AlertCircle} color="text-red-500" subtext="Requires attention" />
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden flex flex-col">
                    <div className="p-6 border-b border-white/5 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2"><History className="w-4 h-4 text-zinc-500" /> Recent Floor Activity</h3>
                        <button onClick={() => setView('admin-logs')} className="text-xs font-bold text-blue-500 hover:text-blue-400">View All</button>
                    </div>
                    <div className="divide-y divide-white/5">
                        {recentLogs.map(l => (
                            <div key={l.id} className="p-4 flex items-center gap-4 hover:bg-white/5 transition-colors">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${l.endTime ? 'bg-zinc-600' : 'bg-green-500 animate-pulse'}`} />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white font-medium truncate"><span className="text-zinc-400">{l.userName}</span> — {l.operation}</p>
                                    <p className="text-xs text-zinc-500 font-mono mt-0.5">{new Date(l.startTime).toLocaleTimeString()} • Job: {l.jobId.substring(0,8)}...</p>
                                </div>
                                <div className="text-right">
                                    {l.durationMinutes ? <span className="text-xs font-bold bg-zinc-800 px-2 py-1 rounded text-zinc-400">{formatDuration(l.durationMinutes)}</span> : <span className="text-xs font-bold text-green-500 uppercase tracking-wider">Running</span>}
                                </div>
                            </div>
                        ))}
                        {recentLogs.length === 0 && <div className="p-8 text-center text-zinc-500">No activity recorded yet.</div>}
                    </div>
                </div>

                <div className="bg-gradient-to-br from-blue-900/20 to-zinc-900/50 border border-blue-500/10 rounded-3xl p-6 relative overflow-hidden">
                    <div className="relative z-10">
                        <h3 className="font-bold text-white text-lg mb-2">Quick Actions</h3>
                        <div className="space-y-3">
                            <button onClick={() => setView('admin-jobs')} className="w-full bg-blue-600 hover:bg-blue-500 text-white p-4 rounded-xl font-bold flex items-center gap-3 transition-all shadow-lg shadow-blue-900/20"><Plus className="w-5 h-5" /> Create New Job</button>
                            <button onClick={() => setView('admin-scan')} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white p-4 rounded-xl font-bold flex items-center gap-3 transition-all"><ScanLine className="w-5 h-5" /> Open Work Station</button>
                            <button onClick={() => setView('admin-team')} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white p-4 rounded-xl font-bold flex items-center gap-3 transition-all"><Users className="w-5 h-5" /> Manage Team</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const JobsView = ({ user, addToast, setPrintable, confirm }: any) => {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
    const [filterPriority, setFilterPriority] = useState<JobPriority | 'all'>('all');
    const [search, setSearch] = useState('');
    const [editingJob, setEditingJob] = useState<Partial<Job>>({});
    const [showModal, setShowModal] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    useEffect(() => DB.subscribeJobs(setJobs), []);

    const filteredJobs = useMemo(() => {
        return jobs.filter(j => {
            // Tab filter
            const isCompleted = j.status === 'completed';
            if (activeTab === 'active' && isCompleted) return false;
            if (activeTab === 'completed' && !isCompleted) return false;

            // Search Filter
            if (search) {
                const s = search.toLowerCase();
                return j.poNumber.toLowerCase().includes(s) || 
                       j.partNumber.toLowerCase().includes(s) || 
                       j.jobIdsDisplay.toLowerCase().includes(s) ||
                       (j.customer || '').toLowerCase().includes(s);
            }
            return true;
        }).sort((a,b) => {
            if (activeTab === 'completed') return (b.completedAt || 0) - (a.completedAt || 0);
            
            const pMap = { urgent: 0, high: 1, normal: 2, low: 3, undefined: 2 };
            const pA = pMap[a.priority || 'normal'] || 2;
            const pB = pMap[b.priority || 'normal'] || 2;
            if (pA !== pB) return pA - pB;
            return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
        });
    }, [jobs, search, activeTab, filterPriority]);

    const stats = useMemo(() => {
        const { startOfWeek, startOfMonth, startOfYear } = getDates();
        const completed = jobs.filter(j => j.status === 'completed' && j.completedAt);
        return {
            week: completed.filter(j => j.completedAt! >= startOfWeek).length,
            month: completed.filter(j => j.completedAt! >= startOfMonth).length,
            year: completed.filter(j => j.completedAt! >= startOfYear).length,
            total: completed.length
        };
    }, [jobs]);

    const handleSave = async () => {
        if (!editingJob.poNumber || !editingJob.partNumber) return addToast('error', 'PO and Part Number required');
        setIsSaving(true);
        const job: Job = {
            id: editingJob.id || Date.now().toString(),
            jobIdsDisplay: editingJob.jobIdsDisplay || editingJob.poNumber || 'J-' + Date.now().toString().slice(-4),
            poNumber: editingJob.poNumber,
            partNumber: editingJob.partNumber,
            quantity: editingJob.quantity || 0,
            customer: editingJob.customer || '',
            priority: editingJob.priority || 'normal',
            dueDate: editingJob.dueDate || '',
            info: editingJob.info || '',
            status: editingJob.status || 'pending',
            dateReceived: editingJob.dateReceived || new Date().toISOString().split('T')[0],
            createdAt: editingJob.createdAt || Date.now()
        };
        
        try {
            await DB.saveJob(job);
            setShowModal(false);
            setEditingJob({});
            addToast('success', 'Job Saved');
        } catch(e) { addToast('error', 'Save Failed'); }
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

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Briefcase className="w-6 h-6 text-blue-500" /> Production Jobs</h2>
                    <p className="text-zinc-500 text-sm">Manage orders and prioritize by PO.</p>
                </div>
                <button onClick={() => { setEditingJob({}); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2 transition-all"><Plus className="w-4 h-4" /> New Job Order</button>
            </div>

            <div className="flex flex-col gap-6">
                <div className="flex gap-2 border-b border-white/5 pb-2">
                    <button onClick={() => setActiveTab('active')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>Active Production</button>
                    <button onClick={() => setActiveTab('completed')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'completed' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>Completed History</button>
                </div>

                {activeTab === 'completed' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
                        <div className="bg-zinc-900/50 border border-emerald-500/20 p-4 rounded-2xl">
                            <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-1">Completed This Week</p>
                            <p className="text-3xl font-black text-white">{stats.week}</p>
                        </div>
                        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl">
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Completed This Month</p>
                            <p className="text-3xl font-black text-white">{stats.month}</p>
                        </div>
                        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl">
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">Completed This Year</p>
                            <p className="text-3xl font-black text-white">{stats.year}</p>
                        </div>
                    </div>
                )}

                <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO, Job ID, or Part..." className="w-full bg-zinc-950 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>
            </div>

            <div className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                    <thead className="bg-zinc-950/50 text-zinc-500 uppercase tracking-wider font-bold text-xs">
                        <tr>
                            <th className="p-4">PO Number (Primary)</th>
                            <th className="p-4">Job ID</th>
                            <th className="p-4">Part Details</th>
                            <th className="p-4">Qty</th>
                            <th className="p-4">Status</th>
                            <th className="p-4">Due</th>
                            <th className="p-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {filteredJobs.map(j => (
                            <tr key={j.id} className="hover:bg-white/5 transition-colors group">
                                <td className="p-4 text-white font-black text-lg">{j.poNumber}</td>
                                <td className="p-4 text-zinc-400 font-mono text-xs">{j.jobIdsDisplay}</td>
                                <td className="p-4">
                                    <div className="text-zinc-300 font-bold">{j.partNumber}</div>
                                    <div className="text-xs text-zinc-500 mt-0.5">{user.role === 'admin' ? j.customer : '***'}</div>
                                </td>
                                <td className="p-4 font-mono text-zinc-300">{j.quantity}</td>
                                <td className="p-4"><StatusBadge status={j.status} /></td>
                                <td className="p-4 font-mono text-zinc-400">{j.dueDate || '—'}</td>
                                <td className="p-4 text-right flex justify-end gap-2">
                                    {/* Action Buttons */}
                                    {activeTab === 'active' && (
                                        <button onClick={() => confirm({ title: "Complete Job", message: "Mark as finished?", onConfirm: () => DB.completeJob(j.id) })} className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-colors" title="Complete Job"><CheckCircle className="w-4 h-4"/></button>
                                    )}
                                    <button onClick={() => setPrintable(j)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white" title="Print Traveler"><Printer className="w-4 h-4"/></button>
                                    <button onClick={() => { setEditingJob(j); setShowModal(true); }} className="p-2 hover:bg-zinc-800 rounded-lg text-blue-400 hover:text-white" title="Edit"><Edit2 className="w-4 h-4"/></button>
                                    <button onClick={() => confirm({ title: "Delete Job", message: "Permanently delete this job?", onConfirm: () => DB.deleteJob(j.id) })} className="p-2 hover:bg-red-500/10 rounded-lg text-red-400 hover:text-red-500" title="Delete"><Trash2 className="w-4 h-4"/></button>
                                </td>
                            </tr>
                        ))}
                        {filteredJobs.length === 0 && <tr><td colSpan={7} className="p-12 text-center text-zinc-500">No jobs found matching filters.</td></tr>}
                    </tbody>
                </table>
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
                            <h3 className="font-bold text-white text-lg">{editingJob.id ? 'Edit Job' : 'Create New Job'}</h3>
                            <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
                        </div>
                        <div className="p-8 overflow-y-auto custom-scrollbar space-y-8">
                            
                            {/* Optional: AI Smart Paste Utility */}
                            <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl mb-4">
                                <div className="flex justify-between items-center mb-2"><label className="text-[10px] uppercase font-bold text-blue-400 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Smart Paste (Optional)</label></div>
                                <textarea placeholder="Paste email/text to auto-fill..." className="w-full bg-black/20 border border-blue-500/10 rounded-lg p-2 text-xs text-blue-200 focus:outline-none placeholder-blue-500/20" rows={1} onBlur={(e) => e.target.value && handleAiParse(e.target.value)} />
                                {aiLoading && <p className="text-xs text-blue-400 mt-1 animate-pulse">Processing...</p>}
                            </div>

                            {/* Section 1: Primary Information */}
                            <div className="space-y-5">
                                <h4 className="text-xs font-black text-blue-400 uppercase tracking-[0.2em] border-b border-blue-500/20 pb-2">1. Primary Information</h4>
                                
                                <div>
                                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Purchase Order (PO) # <span className="text-red-500">*</span></label>
                                    <input 
                                        className="w-full bg-black/40 border-2 border-blue-500/30 focus:border-blue-500 rounded-xl p-4 text-white text-xl font-black outline-none transition-all placeholder-zinc-700 shadow-inner" 
                                        value={editingJob.poNumber || ''} 
                                        onChange={e => setEditingJob({...editingJob, poNumber: e.target.value})} 
                                        placeholder="e.g. PO-4500123" 
                                        autoFocus 
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Part Number <span className="text-red-500">*</span></label>
                                        <input 
                                            className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-bold outline-none focus:ring-2 focus:ring-blue-500/50" 
                                            value={editingJob.partNumber || ''} 
                                            onChange={e => setEditingJob({...editingJob, partNumber: e.target.value})} 
                                            placeholder="e.g. 123-ABC-001"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Internal Job Number</label>
                                        <input 
                                            className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-mono outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-zinc-600" 
                                            value={editingJob.jobIdsDisplay || ''} 
                                            onChange={e => setEditingJob({...editingJob, jobIdsDisplay: e.target.value})} 
                                            placeholder="(Auto-generated if empty)" 
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section 2: Quantity & Timeline */}
                            <div className="space-y-5">
                                <h4 className="text-xs font-black text-emerald-400 uppercase tracking-[0.2em] border-b border-emerald-500/20 pb-2">2. Quantity & Timeline</h4>
                                
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div>
                                        <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Quantity</label>
                                        <input 
                                            type="number" 
                                            className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white font-mono outline-none focus:ring-2 focus:ring-emerald-500/50" 
                                            value={editingJob.quantity || ''} 
                                            onChange={e => setEditingJob({...editingJob, quantity: Number(e.target.value)})} 
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Date Received</label>
                                        <input 
                                            type="date" 
                                            className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50" 
                                            value={editingJob.dateReceived || new Date().toISOString().split('T')[0]} 
                                            onChange={e => setEditingJob({...editingJob, dateReceived: e.target.value})} 
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Due Date</label>
                                        <input 
                                            type="date" 
                                            className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-emerald-500/50" 
                                            value={editingJob.dueDate || ''} 
                                            onChange={e => setEditingJob({...editingJob, dueDate: e.target.value})} 
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Section 3: Additional Details */}
                            <div className="space-y-5">
                                <h4 className="text-xs font-black text-orange-400 uppercase tracking-[0.2em] border-b border-orange-500/20 pb-2">3. Additional Details</h4>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {user.role === 'admin' && (
                                        <div>
                                            <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Customer Name</label>
                                            <input 
                                                className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" 
                                                value={editingJob.customer || ''} 
                                                onChange={e => setEditingJob({...editingJob, customer: e.target.value})} 
                                                placeholder="Client Name"
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Priority Level</label>
                                        <select 
                                            className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500/50" 
                                            value={editingJob.priority || 'normal'} 
                                            onChange={e => setEditingJob({...editingJob, priority: e.target.value as any})}
                                        >
                                            <option value="low">Low</option>
                                            <option value="normal">Normal</option>
                                            <option value="high">High</option>
                                            <option value="urgent">Urgent</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-zinc-400 uppercase ml-1 mb-1 block">Notes / Special Instructions</label>
                                    <textarea 
                                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-4 text-white min-h-[120px] outline-none focus:ring-2 focus:ring-orange-500/50 resize-y leading-relaxed" 
                                        value={editingJob.info || ''} 
                                        onChange={e => setEditingJob({...editingJob, info: e.target.value})} 
                                        placeholder="Enter any process details, material specs, or special requirements here..."
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-5 border-t border-white/10 bg-zinc-800/50 flex justify-end gap-3">
                            <button onClick={() => setShowModal(false)} className="px-5 py-2 text-zinc-400 hover:text-white font-medium">Cancel</button>
                            <button disabled={isSaving} onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-2 rounded-xl font-bold shadow-lg shadow-blue-900/20 flex items-center gap-2">
                                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />}
                                Save Job
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- LOGS VIEW (ENHANCED ANALYTICS) ---
const LogsView = ({ user, addToast }: { user: User, addToast: any }) => {
   const [logs, setLogs] = useState<TimeLog[]>([]);
   const [jobs, setJobs] = useState<Job[]>([]);
   const [users, setUsers] = useState<User[]>([]);
   const [viewMode, setViewMode] = useState<'job' | 'date'>('job');
   const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
   const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
   const [showEditModal, setShowEditModal] = useState(false);
   const [ops, setOps] = useState<string[]>([]);

   useEffect(() => {
     const unsub1 = DB.subscribeLogs(setLogs);
     const unsub2 = DB.subscribeJobs(setJobs);
     const unsub3 = DB.subscribeUsers(setUsers);
     setOps(DB.getSettings().customOperations);
     return () => { unsub1(); unsub2(); unsub3(); };
   }, []);

   // Analytics Logic
   const stats = useMemo(() => {
       const { startOfDay, startOfWeek, startOfMonth, startOfYear } = getDates();
       let today = 0, week = 0, month = 0, year = 0;
       const opStats: Record<string, number> = {};
       
       logs.forEach(l => {
           const mins = l.durationMinutes || 0;
           if (l.startTime >= startOfDay) today += mins;
           if (l.startTime >= startOfWeek) week += mins;
           if (l.startTime >= startOfMonth) month += mins;
           if (l.startTime >= startOfYear) year += mins;
           
           if (mins > 0) {
               opStats[l.operation] = (opStats[l.operation] || 0) + mins;
           }
       });

       return { 
           today: formatDuration(today), 
           week: formatDuration(week), 
           month: formatDuration(month), 
           year: formatDuration(year),
           ops: Object.entries(opStats).sort((a,b) => b[1] - a[1]) 
       };
   }, [logs]);

   // Grouping
   const groupedByJob = useMemo(() => {
       const groups: Record<string, { job: Job | undefined, logs: TimeLog[], totalMinutes: number }> = {};
       logs.forEach(l => {
           if (!groups[l.jobId]) {
               groups[l.jobId] = { job: jobs.find(j => j.id === l.jobId), logs: [], totalMinutes: 0 };
           }
           groups[l.jobId].logs.push(l);
           if (l.durationMinutes) groups[l.jobId].totalMinutes += l.durationMinutes;
       });
       return Object.values(groups).sort((a, b) => (a.job?.status !== 'completed' ? -1 : 1));
   }, [logs, jobs]);

   // ... (handlers handleSaveLog, handleDeleteLog same as before) ...
   const handleSaveLog = async () => {
       if (!editingLog) return;
       try { await DB.updateTimeLog(editingLog); addToast('success', 'Log updated'); setShowEditModal(false); setEditingLog(null); } catch(e) { addToast('error', 'Update failed'); }
   };
   const handleDeleteLog = async () => {
       if (!editingLog) return;
       if (!window.confirm("Delete this log?")) return;
       try { await DB.deleteTimeLog(editingLog.id); addToast('success', 'Log deleted'); setShowEditModal(false); setEditingLog(null); } catch(e) { addToast('error', 'Delete failed'); }
   };

   return (
      <div className="space-y-6">
         {/* Top Stats Bar */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                 <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Today</p>
                 <p className="text-xl font-black text-white">{stats.today}</p>
             </div>
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                 <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">This Week</p>
                 <p className="text-xl font-black text-white">{stats.week}</p>
             </div>
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                 <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">This Month</p>
                 <p className="text-xl font-black text-white">{stats.month}</p>
             </div>
             <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                 <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">This Year</p>
                 <p className="text-xl font-black text-white">{stats.year}</p>
             </div>
         </div>

         {/* Op Stats Visual */}
         {stats.ops.length > 0 && (
             <div className="bg-zinc-900/30 border border-white/5 p-4 rounded-2xl">
                 <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Time by Operation</h3>
                 <div className="space-y-3">
                     {stats.ops.slice(0, 5).map(([op, mins]) => (
                         <div key={op}>
                             <div className="flex justify-between text-xs mb-1">
                                 <span className="text-zinc-300 font-bold">{op}</span>
                                 <span className="text-zinc-500 font-mono">{formatDuration(mins)}</span>
                             </div>
                             <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                                 <div className="bg-blue-600 h-full rounded-full" style={{ width: `${Math.min(100, (mins / stats.ops[0][1]) * 100)}%` }}></div>
                             </div>
                         </div>
                     ))}
                 </div>
             </div>
         )}

         <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 border-b border-white/5 pb-4">
             <h2 className="text-2xl font-bold text-white flex items-center gap-2"><Calendar className="w-6 h-6 text-blue-500" /> Detailed Work Logs</h2>
             <div className="flex gap-2">
                 <button onClick={() => setViewMode('job')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'job' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>By Job Block</button>
                 <button onClick={() => setViewMode('date')} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'date' ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>Daily Timeline</button>
             </div>
         </div>

         {viewMode === 'job' && (
             <div className="space-y-4">
                 <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-4 mb-2">Active Jobs</h3>
                 {groupedByJob.filter(g => g.job?.status !== 'completed').map(group => (
                     <div key={group.job?.id || Math.random()} className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden transition-all">
                         <div 
                            className="p-4 flex flex-col md:flex-row md:items-center justify-between cursor-pointer hover:bg-white/5 gap-4"
                            onClick={() => setExpandedJobId(expandedJobId === group.job?.id ? null : group.job?.id || '')}
                         >
                             <div className="flex items-start gap-4">
                                 <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl mt-1"><Briefcase className="w-6 h-6" /></div>
                                 <div>
                                     {/* PO Number Priority */}
                                     <h4 className="font-black text-white text-xl">{group.job?.poNumber || 'Unknown PO'}</h4>
                                     <p className="text-sm text-zinc-400 font-mono mt-1">{group.job?.jobIdsDisplay} • <span className="text-zinc-500 font-sans">{group.job?.partNumber}</span></p>
                                 </div>
                             </div>
                             <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto">
                                 <div className="text-right">
                                     <p className="text-xs text-zinc-500 uppercase font-bold">Total Time</p>
                                     <p className="font-mono text-xl font-bold text-white">{formatDuration(group.totalMinutes)}</p>
                                 </div>
                                 {expandedJobId === group.job?.id ? <ChevronUp className="w-5 h-5 text-zinc-600"/> : <ChevronDown className="w-5 h-5 text-zinc-600"/>}
                             </div>
                         </div>
                         {expandedJobId === group.job?.id && (
                             <div className="bg-black/20 border-t border-white/5 p-4 animate-fade-in">
                                 <table className="w-full text-sm text-left">
                                     <thead className="text-zinc-600 text-xs uppercase"><tr><th className="pb-2">Date</th><th className="pb-2">Operator</th><th className="pb-2">Operation</th><th className="pb-2 text-right">Duration</th><th className="pb-2 text-right">Edit</th></tr></thead>
                                     <tbody className="divide-y divide-white/5 text-zinc-400">
                                         {group.logs.sort((a,b) => b.startTime - a.startTime).map(l => (
                                             <tr key={l.id}>
                                                 <td className="py-2">{new Date(l.startTime).toLocaleDateString()}</td>
                                                 <td className="py-2 text-white">{l.userName}</td>
                                                 <td className="py-2"><span className="bg-zinc-800 px-2 py-1 rounded text-xs">{l.operation}</span></td>
                                                 <td className="py-2 text-right font-mono">{l.endTime ? formatDuration(l.durationMinutes) : <span className="text-emerald-500 font-bold">Active</span>}</td>
                                                 <td className="py-2 text-right"><button onClick={() => { setEditingLog(l); setShowEditModal(true); }} className="hover:text-white"><Edit2 className="w-3 h-3" /></button></td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                         )}
                     </div>
                 ))}

                 <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-8 mb-2">Completed History</h3>
                 {groupedByJob.filter(g => g.job?.status === 'completed').map(group => (
                     <div key={group.job?.id || Math.random()} className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden opacity-75 hover:opacity-100 transition-all">
                         <div 
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5"
                            onClick={() => setExpandedJobId(expandedJobId === group.job?.id ? null : group.job?.id || '')}
                         >
                             <div className="flex items-center gap-4">
                                 <div className="p-3 bg-zinc-800 text-zinc-500 rounded-xl"><CheckCircle className="w-6 h-6" /></div>
                                 <div>
                                     <h4 className="font-bold text-zinc-300 text-lg decoration-zinc-600 line-through decoration-2">{group.job?.poNumber}</h4>
                                     <p className="text-xs text-zinc-600">{group.job?.jobIdsDisplay} • Final Time: {formatDuration(group.totalMinutes)}</p>
                                 </div>
                             </div>
                             {expandedJobId === group.job?.id ? <ChevronUp className="w-5 h-5 text-zinc-700"/> : <ChevronDown className="w-5 h-5 text-zinc-700"/>}
                         </div>
                         {expandedJobId === group.job?.id && (
                             <div className="bg-black/20 border-t border-white/5 p-4 animate-fade-in">
                                 <table className="w-full text-sm text-left">
                                     <thead className="text-zinc-600 text-xs uppercase"><tr><th className="pb-2">Date</th><th className="pb-2">Operator</th><th className="pb-2">Operation</th><th className="pb-2 text-right">Duration</th></tr></thead>
                                     <tbody className="divide-y divide-white/5 text-zinc-500">
                                         {group.logs.sort((a,b) => b.startTime - a.startTime).map(l => (
                                             <tr key={l.id}>
                                                 <td className="py-2">{new Date(l.startTime).toLocaleDateString()}</td>
                                                 <td className="py-2">{l.userName}</td>
                                                 <td className="py-2">{l.operation}</td>
                                                 <td className="py-2 text-right font-mono">{formatDuration(l.durationMinutes)}</td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                         )}
                     </div>
                 ))}
             </div>
         )}

         {viewMode === 'date' && (
             <div className="p-8 text-center border border-white/5 rounded-2xl bg-zinc-900/20">
                 <History className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                 <p className="text-zinc-500 font-medium">Daily Timeline View is available but "By Job Block" is recommended for job costing.</p>
                 <button onClick={() => setViewMode('job')} className="mt-4 text-blue-500 hover:text-blue-400 text-sm font-bold">Switch back to Job View</button>
             </div>
         )}

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
        <ActiveJobPanel job={activeJob} log={activeLog} onStop={handleStopJob} isAdmin={user.role === 'admin'} />
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

export function App() {
  const [user, setUser] = useState<User | null>(() => { try { return JSON.parse(localStorage.getItem("nexus_user") || "null"); } catch { return null; } });
  const [view, setView] = useState<AppView>("login");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [printable, setPrintable] = useState<Job | null>(null);
  const [confirmModal, setConfirmModal] = useState<any>(null);

  useEffect(() => {
    if (user) localStorage.setItem("nexus_user", JSON.stringify(user));
    else localStorage.removeItem("nexus_user");
    
    if (!user) setView("login");
    else if (user.role === "admin" && view === "login") setView("admin-dashboard");
    else if (user.role === "employee" && view === "login") setView("employee-scan");
  }, [user]);

  const addToast = (t: any, m: any) => setToasts((p) => [...p, { id: Date.now().toString(), type: t, message: m }]);

  const NavItem = ({ id, label, icon: Icon }: any) => (
    <button onClick={() => setView(id)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${view === id ? 'bg-zinc-800 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}>
        <Icon className="w-4 h-4" /> {label}
    </button>
  );

  if (!user || view === "login") {
    return (
      <ErrorBoundary>
        <PrintStyles />
        <LoginView onLogin={setUser} addToast={addToast} />
        <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
          <div className="pointer-events-auto flex flex-col gap-2">
            {toasts.map((t) => <Toast key={t.id} toast={t} onClose={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />)}
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans selection:bg-blue-500/30">
        <PrintStyles />
        <PrintableJobSheet job={printable} onClose={() => setPrintable(null)} isAdmin={user.role === 'admin'} />
        
        {user.role === 'admin' && (
             <aside className="w-64 border-r border-white/5 bg-zinc-900/30 flex flex-col fixed h-full z-20 backdrop-blur-xl">
                <div className="p-6">
                    <div className="flex items-center gap-3 font-black text-xl tracking-tight text-white mb-1"><Sparkles className="w-6 h-6 text-blue-500 fill-blue-500/20" /> SC DEBURRING</div>
                </div>
                <div className="px-4 py-2 space-y-1">
                    <p className="px-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2 mt-4">Management</p>
                    <NavItem id="admin-dashboard" label="Overview" icon={LayoutDashboard} />
                    <NavItem id="admin-jobs" label="Jobs & Production" icon={Briefcase} />
                    <NavItem id="admin-logs" label="Work Logs" icon={Calendar} />
                    
                    <p className="px-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2 mt-6">Shop Floor</p>
                    <NavItem id="admin-team" label="Team Members" icon={Users} />
                    <NavItem id="admin-scan" label="Work Station Mode" icon={ScanLine} />
                    
                    <p className="px-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-2 mt-6">System</p>
                    <NavItem id="admin-settings" label="Settings" icon={Settings} />
                </div>
                <div className="mt-auto p-4 border-t border-white/5">
                    <button onClick={() => setUser(null)} className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"><LogOut className="w-4 h-4" /> Sign Out</button>
                </div>
             </aside>
        )}

        <main className={`flex-1 p-8 ${user.role === 'admin' ? 'ml-64' : 'max-w-6xl mx-auto w-full'}`}>
           {view === 'admin-dashboard' && <AdminDashboard user={user} setView={setView} confirmAction={setConfirmModal} />}
           {view === 'admin-jobs' && <JobsView user={user} addToast={addToast} setPrintable={setPrintable} confirm={setConfirmModal} />}
           {view === 'admin-logs' && <LogsView user={user} addToast={addToast} />}
           {view === 'admin-team' && <AdminEmployees addToast={addToast} confirm={setConfirmModal} />}
           {view === 'admin-settings' && <SettingsView addToast={addToast} />}
           {(view === 'admin-scan' || view === 'employee-scan') && <EmployeeDashboard user={user} addToast={addToast} onLogout={user.role === 'admin' ? () => setView('admin-dashboard') : () => setUser(null)} />}
        </main>

        {confirmModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                <div className="bg-zinc-900 border border-white/10 w-full max-w-sm rounded-2xl p-6 shadow-2xl transform scale-100">
                    <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><AlertTriangle className="text-red-500" /> {confirmModal.title}</h3>
                    <p className="text-zinc-400 text-sm mb-6 leading-relaxed">{confirmModal.message}</p>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setConfirmModal(null)} className="px-4 py-2 text-zinc-400 hover:text-white text-sm font-medium">Cancel</button>
                        <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }} className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-red-900/20">Confirm</button>
                    </div>
                </div>
            </div>
        )}
        
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none flex flex-col items-end gap-2">
            {toasts.map((t) => <Toast key={t.id} toast={t} onClose={(id) => setToasts((p) => p.filter((x) => x.id !== id))} />)}
        </div>
      </div>
    </ErrorBoundary>
  );
}