// LogsView — Admin work-log viewer. Groups TimeLog entries by their parent
// job, supports active/completed tabs, date-range filtering, search, backfill,
// log editing/deletion, and Google Sheets export with formatting.
// Extracted from App.tsx as part of the modularization effort.
// Pure move — zero functional changes.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar, Plus, Download, RefreshCw, Search, Filter,
  CheckCircle, Briefcase, Edit2, X, Trash2, Clock,
} from 'lucide-react';

import { Job, User, TimeLog } from '../types';
import * as DB from '../services/mockDb';
import { fmt, toDateTimeLocal, formatDuration, getLogDurationMins } from '../utils/date';

export const LogsView = ({ addToast, confirm }: { addToast: any; confirm?: (cfg: any) => void }) => {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const savedScrollRef = useRef(0);
  const [ops, setOps] = useState<string[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportJobs, setSelectedExportJobs] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [bfJob, setBfJob] = useState('');
  const [bfWorker, setBfWorker] = useState('');
  const [bfOp, setBfOp] = useState('');
  const [bfStart, setBfStart] = useState('');
  const [bfEnd, setBfEnd] = useState('');

  // "active" = job not yet marked complete | "completed" = job marked complete
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('active');
  const [filterSearch, setFilterSearch] = useState('');

  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(firstDay), end: fmt(lastDay) };
  });

  useEffect(() => {
    const unsub1 = DB.subscribeLogs(setLogs);
    const unsub2 = DB.subscribeUsers(setUsers);
    const unsub3 = DB.subscribeJobs(setJobs);
    const unsub4 = DB.subscribeSettings((s) => setOps(s.customOperations || []));
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [refreshKey]);

  // Build quick lookups: jobId → job.status and jobId → full job
  const jobStatusMap = useMemo(() => {
    const map: Record<string, string> = {};
    jobs.forEach(j => { map[j.id] = j.status; });
    return map;
  }, [jobs]);

  const jobMap = useMemo(() => {
    const map: Record<string, Job> = {};
    jobs.forEach(j => { map[j.id] = j; });
    return map;
  }, [jobs]);

  const handleEditLog = (log: TimeLog) => {
    savedScrollRef.current = document.querySelector('main')?.scrollTop ?? 0;
    setEditingLog({ ...log });
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingLog(null);
    requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = savedScrollRef.current;
    });
  };

  const handleSaveLog = async () => {
    if (!editingLog) return;
    if (editingLog.endTime && editingLog.endTime < editingLog.startTime) {
      addToast('error', 'End time cannot be before Start time');
      return;
    }
    try {
      await DB.updateTimeLog(editingLog);
      addToast('success', 'Log updated successfully');
      closeEditModal();
    } catch (e) { addToast('error', 'Failed to update log'); }
  };

  const handleDeleteLog = () => {
    if (!editingLog) return;
    const logToDelete = editingLog;
    const doDelete = async () => {
      try {
        await DB.deleteTimeLog(logToDelete.id);
        addToast('success', 'Log deleted');
        closeEditModal();
      } catch (e) { addToast('error', 'Failed to delete log'); }
    };
    if (confirm) {
      confirm({ title: 'Delete Log', message: `Permanently delete this time entry for ${logToDelete.userName}?`, onConfirm: doDelete });
    } else {
      doDelete();
    }
  };

  const setPreset = (type: 'today' | 'week' | 'month') => {
    const now = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (type === 'today') {
      const s = fmt(now);
      setDateRange({ start: s, end: s });
    } else if (type === 'week') {
      const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() + diff);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      setDateRange({ start: fmt(mon), end: fmt(sun) });
    } else {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setDateRange({ start: fmt(first), end: fmt(last) });
    }
  };

  const groupedLogs = useMemo(() => {
    const [sY, sM, sD] = dateRange.start.split('-').map(Number);
    const startTs = new Date(sY, sM - 1, sD, 0, 0, 0, 0).getTime();
    const [eY, eM, eD] = dateRange.end.split('-').map(Number);
    const endTs = new Date(eY, eM - 1, eD, 23, 59, 59, 999).getTime();

    const term = filterSearch.toLowerCase().trim();

    const filtered = logs.filter(log => {
      //  KEY LOGIC
      // A log belongs to "completed" tab if its parent JOB is marked complete.
      // A log belongs to "active" tab if its parent JOB is NOT yet complete.
      // Individual timer start/stop (log.endTime) is shown INSIDE the group
      // as a detail row  it does NOT drive the tab grouping.
      //
      const jobIsCompleted = jobStatusMap[log.jobId] === 'completed';

      if (activeTab === 'completed' && !jobIsCompleted) return false;
      if (activeTab === 'active'    &&  jobIsCompleted) return false;

      // Date range: use startTime for the check (covers both active & completed logs)
      if (log.startTime < startTs || log.startTime > endTs) return false;

      // Search — includes job's poNumber and partNumber from the job record
      if (term) {
        const job = jobMap[log.jobId];
        const haystack = [
          log.jobId, log.jobIdsDisplay, log.userName,
          log.operation, log.partNumber, log.customer,
          job?.poNumber, job?.partNumber,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      return true;
    });

    // Group by the human-readable job display ID
    const groups: Record<string, {
      jobId: string;
      internalJobId: string;
      partNumber: string;
      customer: string;
      dueDate: string;
      poNumber: string;
      quantity: number;
      jobIsCompleted: boolean;
      completedAt: number | null;
      logs: TimeLog[];
      totalDurationMinutes: number;
      users: Set<string>;
      lastActivity: number;
      runningCount: number;   // timers still ticking
      stoppedCount: number;   // timers that have been stopped
    }> = {};

    filtered.forEach(log => {
      const displayKey = log.jobIdsDisplay || log.jobId || 'Unknown Job';
      if (!groups[displayKey]) {
        // Pull extra info from the jobs list
        const job = jobs.find(j => j.id === log.jobId);
        groups[displayKey] = {
          jobId: displayKey,
          internalJobId: log.jobId,
          partNumber: log.partNumber || job?.partNumber || 'N/A',
          customer:   log.customer  || job?.customer  || '',
          dueDate:    job?.dueDate  || '',
          poNumber:   job?.poNumber || '',
          quantity:   job?.quantity || 0,
          jobIsCompleted: jobStatusMap[log.jobId] === 'completed',
          completedAt:    job?.completedAt || null,
          logs: [],
          totalDurationMinutes: 0,
          users: new Set(),
          lastActivity: 0,
          runningCount: 0,
          stoppedCount: 0,
        };
      }
      const g = groups[displayKey];
      g.logs.push(log);
      if (log.durationMinutes) g.totalDurationMinutes += log.durationMinutes;
      g.users.add(log.userName);
      const t = log.endTime || log.startTime;
      if (t > g.lastActivity) g.lastActivity = t;
      if (log.endTime) g.stoppedCount++;
      else g.runningCount++;
    });

    return Object.values(groups)
      .sort((a, b) => {
        // Completed jobs: sort by when job was completed, newest first
        if (a.jobIsCompleted && b.jobIsCompleted) {
          return (b.completedAt || b.lastActivity) - (a.completedAt || a.lastActivity);
        }
        // Active jobs: sort by most recent activity
        return b.lastActivity - a.lastActivity;
      })
      .map(g => {
        g.logs.sort((a, b) => b.startTime - a.startTime);
        return g;
      });
  }, [logs, jobs, jobStatusMap, jobMap, activeTab, dateRange, filterSearch]);

  const totalHours    = groupedLogs.reduce((acc, g) => acc + g.totalDurationMinutes / 60, 0);
  const totalEntries  = groupedLogs.reduce((acc, g) => acc + g.logs.length, 0);

  // Counts for the tab badges (based on JOB status, not log status)
  const jobsWithLogs     = useMemo(() => new Set(logs.map(l => l.jobId)), [logs]);
  const activeJobCount   = useMemo(() => [...jobsWithLogs].filter(id => jobStatusMap[id] !== 'completed').length, [jobsWithLogs, jobStatusMap]);
  const completedJobCount= useMemo(() => [...jobsWithLogs].filter(id => jobStatusMap[id] === 'completed').length, [jobsWithLogs, jobStatusMap]);

  // ── CSV Export ───────────────────────────────────────────────────────────────
  const openExportModal = () => {
    // Pre-select all jobs by default
    setSelectedExportJobs(new Set(groupedLogs.map(g => g.jobId)));
    setShowExportModal(true);
  };

  const toggleExportJob = (jobId: string) => {
    setSelectedExportJobs(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  const fmtDur = (mins: number) => {
    if (!mins) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const csvEscape = (val: string | number | undefined) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportToGoogleSheets = () => {
    const exportGroups = groupedLogs.filter(g => selectedExportJobs.has(g.jobId));
    if (exportGroups.length === 0) { addToast('error', 'Select at least one PO to export'); return; }
    if (typeof (window as any).__requestSheetsAccess !== 'function') {
      addToast('error', 'Google Sheets not available'); return;
    }

    setExporting(true);

    (window as any).__requestSheetsAccess(async (success: boolean, err: string) => {
      if (!success) {
        addToast('error', 'Google access denied: ' + (err || 'Unknown error'));
        setExporting(false); return;
      }
      try {
        const sheetsToken: string = (window as any).__sheetsToken;
        const drStart = new Date(dateRange.start + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const drEnd   = new Date(dateRange.end   + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        const totalExportMins = exportGroups.reduce((a, g) => a + g.totalDurationMinutes, 0);
        const now = new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
        const title = `SC Deburring Work Logs — ${drStart} to ${drEnd}`;

        // ── Build rows + track formatting targets ──────────────────
        const rows: any[][] = [];
        const formatRequests: any[] = [];

        // Helper: record row index BEFORE pushing
        const colCount = 13;

        // Rows 0-4: Report header
        rows.push(['SC DEBURRING — Work Log Export', ...Array(colCount - 1).fill('')]);
        rows.push([`Date Range: ${drStart} to ${drEnd}`, ...Array(colCount - 1).fill('')]);
        rows.push([`Generated: ${now}  |  POs: ${exportGroups.length}  |  Total Hours: ${(totalExportMins / 60).toFixed(2)}`, ...Array(colCount - 1).fill('')]);
        rows.push(Array(colCount).fill(''));

        // Row 4: Column headers
        const headerRowIdx = rows.length;
        rows.push(['PO Number', 'SC Job #', 'Part Number', 'Customer', 'Status', 'Date', 'Employee', 'Operation', 'Start', 'End', 'Mins', 'Duration', 'Timer']);

        const jobSeparatorRowIdxs: number[] = [];
        const subtotalRowIdxs: number[] = [];
        const logRowIdxs: number[] = [];

        exportGroups.forEach(group => {
          rows.push(Array(colCount).fill('')); // blank

          // Job separator
          jobSeparatorRowIdxs.push(rows.length);
          rows.push([
            `PO: ${group.poNumber || group.jobId}`,
            `SC#: ${group.jobId}`,
            `Part: ${group.partNumber}`,
            group.customer || '',
            group.jobIsCompleted ? 'COMPLETED' : 'ACTIVE',
            `Total: ${fmtDur(group.totalDurationMinutes)}`,
            `Staff: ${[...group.users].join(', ')}`,
            '', '', '', '', '', '',
          ]);

          // Log entries
          group.logs.forEach(log => {
            logRowIdxs.push(rows.length);
            rows.push([
              group.poNumber || group.jobId,
              group.jobId,
              group.partNumber,
              group.customer || '',
              group.jobIsCompleted ? 'Completed' : 'Active',
              fmtDate(log.startTime),
              log.userName,
              log.operation,
              fmtTime(log.startTime),
              log.endTime ? fmtTime(log.endTime) : 'Running',
              log.durationMinutes ? Math.round(log.durationMinutes) : '',
              log.durationMinutes ? fmtDur(log.durationMinutes) : '',
              log.endTime ? 'Stopped' : 'Live',
            ]);
          });

          // Subtotal
          subtotalRowIdxs.push(rows.length);
          rows.push(['', '', '', '', '', 'JOB TOTAL', '', '', '', '',
            Math.round(group.totalDurationMinutes),
            fmtDur(group.totalDurationMinutes), '']);
        });

        rows.push(Array(colCount).fill(''));
        const grandTotalRowIdx = rows.length;
        rows.push(['GRAND TOTAL', '', '', '', '', '', '', '', '', '',
          Math.round(totalExportMins), fmtDur(totalExportMins), '']);

        // ── Create spreadsheet ────────────────────────────────────
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${sheetsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            properties: { title },
            sheets: [{ properties: { title: 'Work Logs', gridProperties: { frozenRowCount: headerRowIdx + 1 } } }]
          }),
        });
        if (!createRes.ok) throw new Error(`Create failed: ${await createRes.text()}`);
        const createData = await createRes.json();
        const spreadsheetId = createData.spreadsheetId;
        const spreadsheetUrl = createData.spreadsheetUrl;
        const sheetId = createData.sheets[0].properties.sheetId;

        // ── Write values ──────────────────────────────────────────
        const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Work%20Logs!A1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${sheetsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: rows }),
        });
        if (!writeRes.ok) throw new Error(`Write failed: ${await writeRes.text()}`);

        // ── Helper colors ─────────────────────────────────────────
        const rgb = (r: number, g: number, b: number) => ({ red: r/255, green: g/255, blue: b/255 });
        const rowFmt = (rowIdx: number, bg: any, textColor: any, bold: boolean, fontSize?: number) => ({
          repeatCell: {
            range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: { userEnteredFormat: {
              backgroundColor: bg,
              textFormat: { foregroundColor: textColor, bold, fontSize: fontSize || 10 },
              verticalAlignment: 'MIDDLE',
              wrapStrategy: 'CLIP',
            }},
            fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)',
          }
        });

        // Title row (row 0)
        formatRequests.push(rowFmt(0, rgb(15, 23, 42), rgb(255,255,255), true, 13));
        // Info rows (1-2)
        formatRequests.push(rowFmt(1, rgb(30, 41, 59), rgb(148,163,184), false, 9));
        formatRequests.push(rowFmt(2, rgb(30, 41, 59), rgb(148,163,184), false, 9));
        // Column header row
        formatRequests.push(rowFmt(headerRowIdx, rgb(30, 64, 175), rgb(255,255,255), true, 10));
        // Job separator rows
        jobSeparatorRowIdxs.forEach(i => formatRequests.push(rowFmt(i, rgb(55, 65, 81), rgb(229,231,235), true, 10)));
        // Subtotal rows
        subtotalRowIdxs.forEach(i => formatRequests.push(rowFmt(i, rgb(220, 252, 231), rgb(21, 128, 61), true, 10)));
        // Grand total row
        formatRequests.push(rowFmt(grandTotalRowIdx, rgb(21, 128, 61), rgb(255,255,255), true, 11));

        // Alternating log row colors
        logRowIdxs.forEach((i, idx) => {
          const bg = idx % 2 === 0 ? rgb(255,255,255) : rgb(248,250,252);
          formatRequests.push(rowFmt(i, bg, rgb(30,41,59), false, 10));
        });

        // Column widths
        const colWidths = [120, 90, 110, 100, 80, 85, 90, 130, 80, 80, 50, 70, 60];
        colWidths.forEach((px, i) => {
          formatRequests.push({
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
              properties: { pixelSize: px },
              fields: 'pixelSize',
            }
          });
        });

        // Row heights
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: rows.length },
            properties: { pixelSize: 22 },
            fields: 'pixelSize',
          }
        });
        // Taller title row
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 32 },
            fields: 'pixelSize',
          }
        });

        // ── Apply formatting ───────────────────────────────────────
        const fmtRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${sheetsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: formatRequests }),
        });
        if (!fmtRes.ok) throw new Error(`Format failed: ${await fmtRes.text()}`);

        window.open(spreadsheetUrl, '_blank');
        setShowExportModal(false);
        addToast('success', `Opened in Google Sheets — ${exportGroups.length} PO${exportGroups.length !== 1 ? 's' : ''} exported`);
      } catch (e: any) {
        addToast('error', 'Export failed: ' + (e?.message || 'Unknown error'));
      } finally {
        setExporting(false);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 no-print">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2 text-white"><Calendar className="w-6 h-6 text-blue-500" /> Work Logs</h2>
          <p className="text-zinc-500 text-sm mt-1">Time entries grouped by job. Filter by date, status, or search.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { setShowBackfill(true); setBfJob(''); setBfWorker(''); setBfOp(''); setBfStart(''); setBfEnd(''); }} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-colors">
            <Plus className="w-4 h-4" /> Backfill Entry
          </button>
          <button onClick={openExportModal} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-colors shadow-lg shadow-emerald-900/20">
            <Download className="w-4 h-4" /> Export
          </button>
          <button aria-label="Refresh data" onClick={() => setRefreshKey(k => k + 1)} className="px-3 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" title="Refresh"><RefreshCw className="w-4 h-4" aria-hidden="true" /></button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 no-print">
        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Jobs Shown</p>
          <p className="text-2xl font-bold text-white">{groupedLogs.length}</p>
        </div>
        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Total Hours</p>
          <p className="text-2xl font-bold text-blue-400">{totalHours.toFixed(1)}h</p>
        </div>
        <div className="bg-zinc-900/50 border border-orange-500/10 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Active Jobs</p>
          <p className="text-2xl font-bold text-orange-400">{activeJobCount}</p>
        </div>
        <div className="bg-zinc-900/50 border border-emerald-500/10 p-4 rounded-xl">
          <p className="text-zinc-500 text-xs uppercase font-bold">Completed Jobs</p>
          <p className="text-2xl font-bold text-emerald-400">{completedJobCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-zinc-900 border border-white/10 rounded-2xl p-3 sm:p-4 space-y-3 sm:space-y-4 no-print">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-2 sm:gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-zinc-500">Start Date</label>
            <input aria-label="Start date" type="date" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white w-full sm:min-w-[130px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase font-bold text-zinc-500">End Date</label>
            <input aria-label="End date" type="date" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg p-2 text-xs text-white w-full sm:min-w-[130px]" />
          </div>
          <div className="flex gap-1 col-span-2 sm:col-span-1">
            {(['today', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setPreset(p)} className="flex-1 sm:flex-initial px-3 py-2 text-xs font-bold rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors capitalize">{p}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
          {/* Tabs driven by JOB status */}
          <div className="bg-black/30 p-1 rounded-xl flex gap-1 shrink-0">
            {([
              { key: 'all',       label: 'All Jobs',        count: activeJobCount + completedJobCount },
              { key: 'active',    label: ' Active Jobs',  count: activeJobCount },
              { key: 'completed', label: ' Completed Jobs',count: completedJobCount },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${activeTab === key ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {label}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${activeTab === key ? 'bg-zinc-600 text-zinc-200' : 'bg-zinc-800 text-zinc-500'}`}>{count}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 relative w-full">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            <input
              placeholder="Search by PO#, Part#, Employee, Operation..."
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/10 rounded-xl text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Grouped Logs */}
      <div className="space-y-4">
        {groupedLogs.length === 0 && (
          <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div className="inline-block p-4 rounded-full bg-zinc-800 mb-4"><Filter className="w-8 h-8 text-zinc-600" /></div>
            <p className="font-medium">No logs found matching your filters.</p>
            <p className="text-sm mt-2 text-zinc-600">Try adjusting the date range or switching tabs.</p>
          </div>
        )}

        {groupedLogs.map(group => (
          <div key={group.jobId}
            className={`border rounded-2xl overflow-hidden shadow-sm transition-all ${
              group.jobIsCompleted
                ? 'bg-emerald-950/20 border-emerald-500/20 hover:border-emerald-500/40'
                : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
            }`}
          >
            {/* Group Header */}
            <div className={`p-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4 ${group.jobIsCompleted ? 'bg-emerald-950/30 border-emerald-500/10' : 'bg-zinc-900/80 border-white/5'}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${group.jobIsCompleted ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                  {group.jobIsCompleted
                    ? <CheckCircle className="w-5 h-5 text-emerald-400" />
                    : <Briefcase className="w-5 h-5 text-blue-500" />
                  }
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-xl font-black text-white leading-tight">{group.poNumber || group.jobId}</h3>
                    {group.jobIsCompleted
                      ? <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">Job Complete</span>
                      : <span className="text-[10px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-full uppercase tracking-wider">In Production</span>
                    }
                  </div>
                  <div className="flex items-center gap-2 text-xs mt-1 flex-wrap">
                    {group.poNumber && <span className="text-zinc-500 font-mono">Job ID: {group.jobId}</span>}
                    {group.poNumber && <span className="text-zinc-700"></span>}
                    <span className="text-zinc-500">Part: <span className="text-zinc-300">{group.partNumber}</span></span>
                    {group.quantity > 0 && <><span className="text-zinc-700"></span><span className="text-zinc-500">Qty: <span className="text-zinc-300">{group.quantity}</span></span></>}
                    {group.customer && <><span className="text-zinc-700"></span><span className="text-zinc-400">{group.customer}</span></>}
                    {group.dueDate  && <><span className="text-zinc-700"></span><span className="text-zinc-500">Due: <span className="text-zinc-300">{fmt(group.dueDate)}</span></span></>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {group.runningCount > 0 && (
                      <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                        {group.runningCount} timer{group.runningCount > 1 ? 's' : ''} running
                      </span>
                    )}
                    {group.stoppedCount > 0 && (
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded-full">
                        {group.stoppedCount} operation{group.stoppedCount > 1 ? 's' : ''} logged
                      </span>
                    )}
                    {group.completedAt && (
                      <span className="text-[10px] text-emerald-500 font-bold">
                        Completed {new Date(group.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs shrink-0">
                <div className="text-right">
                  <p className="text-zinc-500 uppercase font-bold tracking-wide">Total Time</p>
                  <p className={`text-xl font-mono font-bold ${group.jobIsCompleted ? 'text-emerald-400' : 'text-white'}`}>{formatDuration(group.totalDurationMinutes)}</p>
                </div>
                <div className="text-right border-l border-white/10 pl-4">
                  <p className="text-zinc-500 uppercase font-bold tracking-wide">Staff</p>
                  <p className="text-white text-lg font-bold">{group.users.size}</p>
                </div>
                {(() => {
                  const job = jobs.find(j => j.id === group.internalJobId);
                  const ss = DB.getSettings();
                  const r = ss.shopRate || 0;
                  if (!r || !group.totalDurationMinutes) return null;
                  const hrs = group.totalDurationMinutes / 60;
                  const ohR = (ss.monthlyOverhead || 0) / (ss.monthlyWorkHours || 160);
                  const cost = hrs * (r + ohR);
                  const quote = job?.quoteAmount || 0;
                  const profit = quote > 0 ? quote - cost : null;
                  return (
                    <div className="text-right border-l border-white/10 pl-4">
                      <p className="text-zinc-500 uppercase font-bold tracking-wide">Cost</p>
                      <p className="text-white text-lg font-mono font-bold">${cost.toFixed(0)}</p>
                      {profit !== null && (
                        <p className={`text-xs font-black mt-0.5 ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(0)} {profit >= 0 ? 'profit' : 'loss'}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Logs Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-black/20 text-zinc-500 uppercase tracking-wide">
                  <tr>
                    <th className="p-3 pl-6">Date</th>
                    <th className="p-3">Employee</th>
                    <th className="p-3">Operation</th>
                    <th className="p-3">Start → End</th>
                    <th className="p-3">Timer</th>
                    <th className="p-3 text-right pr-6">Duration</th>
                    <th className="p-3 text-right pr-6 no-print"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {group.logs.map(log => (
                    <React.Fragment key={log.id}>
                    <tr className="hover:bg-white/5 transition-colors group/row">
                      <td className="p-3 pl-6 text-zinc-400 whitespace-nowrap">{new Date(log.startTime).toLocaleDateString()}</td>
                      <td className="p-3 text-white font-semibold">{log.userName}</td>
                      <td className="p-3 text-blue-400 font-medium">{log.operation}</td>
                      <td className="p-3 font-mono text-zinc-400 whitespace-nowrap">
                        {new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        <span className="text-zinc-600 mx-1.5" aria-hidden="true">→</span>
                        {log.endTime
                          ? new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : <span className="text-blue-400 font-bold">Running</span>
                        }
                      </td>
                      <td className="p-3">
                        {log.endTime
                          ? <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded-full">Stopped</span>
                          : <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>Live</span>
                        }
                      </td>
                      <td className="p-3 text-right pr-6 font-mono text-zinc-300 font-bold">{formatDuration(getLogDurationMins(log) ?? log.durationMinutes)}</td>
                      <td className="p-3 text-right pr-6 no-print opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button aria-label="Edit log entry" onClick={() => handleEditLog(log)} className="text-blue-500 hover:text-white p-1.5 rounded hover:bg-blue-500/20 transition-colors" title="Edit log"><Edit2 className="w-3 h-3" aria-hidden="true" /></button>
                      </td>
                    </tr>
                    {log.notes && (
                      <tr className="bg-amber-500/5 border-l-2 border-amber-500/40">
                        <td colSpan={7} className="px-6 py-2">
                          <div className="flex items-start gap-2 text-sm">
                            <span className="text-amber-500 mt-0.5">📝</span>
                            <div>
                              <span className="text-amber-300/90">{log.notes}</span>
                              <span className="text-zinc-600 text-xs ml-2">— {log.userName}</span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <h3 className="font-bold text-white flex items-center gap-2"><Edit2 className="w-4 h-4 text-blue-500" /> Edit Time Log</h3>
              <button aria-label="Close dialog" onClick={closeEditModal} className="p-2 rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5 text-zinc-500 hover:text-white" aria-hidden="true" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Employee</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editingLog.userId}
                  onChange={e => {
                    const u = users.find(u => u.id === e.target.value);
                    if (u) setEditingLog({ ...editingLog, userId: u.id, userName: u.name });
                  }}>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Operation</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editingLog.operation}
                  onChange={e => setEditingLog({ ...editingLog, operation: e.target.value })}>
                  {ops.map(o => <option key={o} value={o}>{o}</option>)}
                  {!ops.includes(editingLog.operation) && <option value={editingLog.operation}>{editingLog.operation} (Legacy)</option>}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Start Time</label>
                  <input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                    value={toDateTimeLocal(editingLog.startTime)}
                    onChange={e => setEditingLog({ ...editingLog, startTime: new Date(e.target.value).getTime() })} />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">End Time</label>
                  <input type="datetime-local" className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                    value={toDateTimeLocal(editingLog.endTime)}
                    onChange={e => {
                      const val = e.target.value ? new Date(e.target.value).getTime() : null;
                      setEditingLog({ ...editingLog, endTime: val });
                    }} />
                  <p className="text-[10px] text-zinc-500 mt-1">Clear to mark as active.</p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-between items-center">
              <button onClick={handleDeleteLog} className="text-red-500 hover:text-red-400 text-sm font-bold flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"><Trash2 className="w-4 h-4" /> Delete Log</button>
              <div className="flex gap-2">
                <button onClick={closeEditModal} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button>
                <button onClick={handleSaveLog} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl font-bold">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Backfill Entry Modal ──────────────────────────────────── */}
      {showBackfill && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xl p-0 sm:p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div><h3 className="text-lg font-bold text-white flex items-center gap-2"><Clock className="w-5 h-5 text-blue-400" /> Backfill Time Entry</h3><p className="text-sm text-zinc-400 mt-0.5">Add a past entry for a worker who forgot to scan</p></div>
              <button onClick={() => setShowBackfill(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-4">
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Job</label>
                <select value={bfJob} onChange={e => setBfJob(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white">
                  <option value="">Select job...</option>
                  {jobs.filter(j => j.status !== 'completed').map(j => <option key={j.id} value={j.id}>PO {j.poNumber} — {j.partNumber}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Worker</label>
                <select value={bfWorker} onChange={e => setBfWorker(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white">
                  <option value="">Select worker...</option>
                  {users.filter(u => u.isActive !== false).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Operation</label>
                <select value={bfOp} onChange={e => setBfOp(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white">
                  <option value="">Select operation...</option>
                  {ops.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Start Time</label>
                  <input type="datetime-local" value={bfStart} onChange={e => setBfStart(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white" />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">End Time</label>
                  <input type="datetime-local" value={bfEnd} onChange={e => setBfEnd(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 text-white" />
                </div>
              </div>
              {bfStart && bfEnd && new Date(bfEnd) > new Date(bfStart) && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
                  <span className="text-blue-400 font-bold">{((new Date(bfEnd).getTime() - new Date(bfStart).getTime()) / 3600000).toFixed(1)}h</span>
                  <span className="text-zinc-400 text-sm"> will be logged</span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-white/5 flex gap-3">
              <button onClick={() => setShowBackfill(false)} className="flex-1 py-3 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-sm">Cancel</button>
              <button
                disabled={!bfJob || !bfWorker || !bfOp || !bfStart || !bfEnd || new Date(bfEnd) <= new Date(bfStart)}
                onClick={async () => {
                  try {
                    const job = jobs.find(j => j.id === bfJob);
                    const worker = users.find(u => u.id === bfWorker);
                    if (!job || !worker) return;
                    await DB.createBackfillLog(
                      bfJob, bfWorker, worker.name, bfOp,
                      new Date(bfStart).getTime(), new Date(bfEnd).getTime(),
                      job.partNumber, job.customer, job.jobIdsDisplay
                    );
                    addToast('success', `Backfill logged: ${worker.name} → ${job.poNumber} (${bfOp})`);
                    setShowBackfill(false);
                    setRefreshKey(k => k + 1);
                  } catch (e: any) { addToast('error', e?.message || 'Failed to create backfill'); }
                }}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white font-bold text-sm transition-colors"
              >
                Save Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export CSV Modal ─────────────────────────────────────────── */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xl p-4 animate-fade-in">
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50">
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                  <Download className="w-5 h-5 text-emerald-400" /> Export Work Logs
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {dateRange.start} → {dateRange.end} · {groupedLogs.length} PO{groupedLogs.length !== 1 ? 's' : ''} in current view
                </p>
              </div>
              <button onClick={() => setShowExportModal(false)}><X className="w-5 h-5 text-zinc-500 hover:text-white" /></button>
            </div>

            {/* PO Selector */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Select POs to Export</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedExportJobs(new Set(groupedLogs.map(g => g.jobId)))}
                    className="text-[11px] text-blue-400 hover:text-blue-300 font-bold"
                  >Select All</button>
                  <span className="text-zinc-700">·</span>
                  <button
                    onClick={() => setSelectedExportJobs(new Set())}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 font-bold"
                  >Clear</button>
                </div>
              </div>

              {groupedLogs.length === 0 ? (
                <p className="text-zinc-500 text-sm text-center py-8">No logs in current date range.</p>
              ) : (
                groupedLogs.map(group => {
                  const checked = selectedExportJobs.has(group.jobId);
                  return (
                    <label
                      key={group.jobId}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        checked
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-zinc-800/50 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExportJob(group.jobId)}
                        className="w-4 h-4 accent-emerald-500 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-white text-sm">{group.poNumber || group.jobId}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            group.jobIsCompleted
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                              : 'text-orange-400 bg-orange-500/10 border-orange-500/20'
                          }`}>{group.jobIsCompleted ? 'Completed' : 'Active'}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {group.partNumber}{group.customer ? ` · ${group.customer}` : ''} · {group.logs.length} entr{group.logs.length === 1 ? 'y' : 'ies'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-white font-mono">{fmtDur(group.totalDurationMinutes)}</p>
                        <p className="text-[10px] text-zinc-600">{[...group.users].join(', ')}</p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-white/10 bg-zinc-800/30 space-y-3">
              {/* Summary of selection */}
              {selectedExportJobs.size > 0 && (() => {
                const sel = groupedLogs.filter(g => selectedExportJobs.has(g.jobId));
                const selMins = sel.reduce((a, g) => a + g.totalDurationMinutes, 0);
                const selEntries = sel.reduce((a, g) => a + g.logs.length, 0);
                return (
                  <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-900/50 rounded-lg px-3 py-2">
                    <span><span className="text-white font-bold">{selectedExportJobs.size}</span> PO{selectedExportJobs.size !== 1 ? 's' : ''} selected · <span className="text-white font-bold">{selEntries}</span> entries</span>
                    <span>Total: <span className="text-emerald-400 font-bold">{fmtDur(selMins)}</span></span>
                  </div>
                );
              })()}
              <div className="flex gap-3">
                <button onClick={() => setShowExportModal(false)} disabled={exporting} className="px-4 py-2.5 text-zinc-400 hover:text-white text-sm font-medium transition-colors disabled:opacity-40">Cancel</button>
                <button
                  onClick={exportToGoogleSheets}
                  disabled={selectedExportJobs.size === 0 || exporting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm transition-all"
                >
                  {exporting ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Creating Sheet...</>
                  ) : (
                    <><Download className="w-4 h-4" /> Open in Google Sheets ({selectedExportJobs.size} PO{selectedExportJobs.size !== 1 ? 's' : ''})</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
