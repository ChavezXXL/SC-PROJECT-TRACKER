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

import { Job, User, TimeLog, SystemSettings } from '../types';
import * as DB from '../services/mockDb';
import { fmt, toDateTimeLocal, formatDuration, getLogDurationMins } from '../utils/date';
import { Overlay } from '../components/Overlay';
import { resolveJobStage } from '../utils/stageRouting';
import { getStages } from '../App';

export const LogsView = ({ addToast, confirm }: { addToast: any; confirm?: (cfg: any) => void }) => {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
  // Separate string state for the two datetime-local inputs. Without this,
  // every keystroke tries to round-trip through `new Date().getTime()` —
  // partial values like "2026-04-24T1" parse to NaN, which blanks the
  // input and throws the cursor around. We hold the raw string while the
  // user types and only commit to the log object on save.
  const [editStartStr, setEditStartStr] = useState('');
  const [editEndStr, setEditEndStr] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingLog, setSavingLog] = useState(false);
  const savedScrollRef = useRef(0);
  const [ops, setOps] = useState<string[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportJobs, setSelectedExportJobs] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);
  const [bfJob, setBfJob] = useState('');
  const [bfJobSearch, setBfJobSearch] = useState('');
  const [bfWorker, setBfWorker] = useState('');
  const [bfOp, setBfOp] = useState('');
  const [bfStart, setBfStart] = useState('');
  const [bfEnd, setBfEnd] = useState('');

  // "active" = job not yet marked complete | "completed" = job marked complete
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'completed'>('active');
  const [filterSearch, setFilterSearch] = useState('');

  // Default to "Last 90 days" so logs don't disappear on month rollover or
  // when the shop has a slow week. Previously defaulted to current month only,
  // which made it look like jobs/logs were missing if the user opened the
  // page on day 1 of a new month.
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(ninetyDaysAgo), end: fmt(now) };
  });

  // Settings drive the workflow stages — needed for proper "is this job
  // complete?" check (a job at any stage flagged isComplete:true counts as
  // done, not just legacy status==='completed').
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  useEffect(() => {
    const unsub1 = DB.subscribeLogs(setLogs);
    const unsub2 = DB.subscribeUsers(setUsers);
    const unsub3 = DB.subscribeJobs(setJobs);
    const unsub4 = DB.subscribeSettings((s) => { setOps(s.customOperations || []); setSettings(s); });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [refreshKey]);

  const stages = useMemo(() => settings ? getStages(settings) : [], [settings]);

  // jobId → job lookup
  const jobMap = useMemo(() => {
    const map: Record<string, Job> = {};
    jobs.forEach(j => { map[j.id] = j; });
    return map;
  }, [jobs]);

  // jobId → "is this job done?" — single source of truth used by the tab
  // filter, the per-row badge, and the active/completed counts. A job is
  // considered done if EITHER:
  //   • its legacy `status` is 'completed' (admin clicked "Mark Complete"), or
  //   • its `currentStage` resolves to a stage flagged `isComplete: true`
  //     (job advanced through the workflow into a Done/Delivered/Invoiced
  //     stage — even if `status` was never updated, which can happen when
  //     stages are dragged around in Settings)
  // Orphan logs (parent job deleted) get `null` so we can park them in their
  // own "All Jobs" view rather than letting them flood the Active tab.
  const jobDoneMap = useMemo(() => {
    const map: Record<string, boolean | null> = {};
    jobs.forEach(j => {
      if (j.status === 'completed') { map[j.id] = true; return; }
      if (stages.length === 0) { map[j.id] = false; return; }
      const stage = resolveJobStage(j, stages);
      map[j.id] = stage?.isComplete === true;
    });
    return map;
  }, [jobs, stages]);

  const handleEditLog = (log: TimeLog) => {
    savedScrollRef.current = document.querySelector('main')?.scrollTop ?? 0;
    setEditingLog({ ...log });
    setEditStartStr(toDateTimeLocal(log.startTime));
    setEditEndStr(toDateTimeLocal(log.endTime));
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingLog(null);
    setEditStartStr('');
    setEditEndStr('');
    requestAnimationFrame(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = savedScrollRef.current;
    });
  };

  const handleSaveLog = async () => {
    if (!editingLog || savingLog) return;
    // Convert the string state to timestamps NOW, at save time, after the
    // user is done typing. Empty end = still-running timer.
    const startTs = new Date(editStartStr).getTime();
    if (!editStartStr || Number.isNaN(startTs)) {
      addToast('error', 'Start time is required and must be valid');
      return;
    }
    const endTs = editEndStr ? new Date(editEndStr).getTime() : null;
    if (editEndStr && Number.isNaN(endTs as number)) {
      addToast('error', 'End time must be valid or empty');
      return;
    }
    if (endTs && endTs < startTs) {
      addToast('error', 'End time cannot be before Start time');
      return;
    }
    // Recalculate duration fields whenever timestamps change — without this,
    // editing start/end times leaves durationMinutes stale and corrupts reports.
    const durSeconds = endTs ? Math.max(0, Math.floor((endTs - startTs) / 1000)) : undefined;
    const durMinutes = durSeconds != null ? Math.round(durSeconds / 60) : null;
    const updated: TimeLog = {
      ...editingLog,
      startTime: startTs,
      endTime: endTs as number | null,
      durationSeconds: durSeconds,
      durationMinutes: durMinutes,
      status: endTs ? 'completed' : 'in_progress',
      updatedAt: Date.now(),
    };
    setSavingLog(true);
    try {
      await DB.updateTimeLog(updated);
      addToast('success', 'Log updated');
      closeEditModal();
    } catch (e) {
      console.error('[LogsView] updateTimeLog failed:', e);
      addToast('error', 'Failed to update log');
    } finally {
      setSavingLog(false);
    }
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

  const setPreset = (type: 'today' | 'week' | 'month' | '90d' | 'all') => {
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
    } else if (type === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setDateRange({ start: fmt(first), end: fmt(last) });
    } else if (type === '90d') {
      const ago = new Date(now); ago.setDate(now.getDate() - 90);
      setDateRange({ start: fmt(ago), end: fmt(now) });
    } else {
      // 'all' — wide net, picks up logs from earliest-realistic shop start.
      // Use 5-year lookback rather than epoch so the date pickers don't show
      // 1970 placeholders.
      const ago = new Date(now); ago.setFullYear(now.getFullYear() - 5);
      setDateRange({ start: fmt(ago), end: fmt(now) });
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
      // A log belongs to "completed" tab if its parent JOB is marked complete
      // (either status==='completed' OR resolved into a stage with isComplete).
      // A log belongs to "active" tab if its parent JOB is NOT yet complete.
      // Logs whose parent job has been deleted are ORPHANS — they only
      // appear under "All Jobs", never in Active or Completed, so the user
      // can find + clean them up without polluting the day-to-day tabs.
      const doneState = jobDoneMap[log.jobId]; // true | false | undefined (orphan)

      if (activeTab === 'completed') {
        if (doneState !== true) return false;
      } else if (activeTab === 'active') {
        if (doneState !== false) return false; // excludes done AND orphans
      }
      // 'all' tab includes everything (including orphans)

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
      // Key by the actual jobId (unique Firestore doc id). DO NOT fall back
      // to `jobIdsDisplay` — that's the human-readable label and DEFAULTS TO
      // `poNumber` when a job is created. Two jobs from the same customer
      // referencing the same PO# (re-orders, multi-part POs) would collide
      // and render under one row, with logs visibly leaking between them.
      // If a log somehow has no jobId, it goes to a single "unknown" bucket.
      const groupKey = log.jobId || '__unknown__';
      if (!groups[groupKey]) {
        // Pull extra info from the jobs list
        const job = jobs.find(j => j.id === log.jobId);
        groups[groupKey] = {
          jobId: log.jobIdsDisplay || log.jobId || 'Unknown Job',
          internalJobId: log.jobId || '__unknown__',
          partNumber: log.partNumber || job?.partNumber || 'N/A',
          customer:   log.customer  || job?.customer  || '',
          dueDate:    job?.dueDate  || '',
          poNumber:   job?.poNumber || '',
          quantity:   job?.quantity || 0,
          // Stage-aware completion: matches what the tab filter uses, so the
          // green "Job Complete" badge and the tab classification can never
          // disagree with each other.
          jobIsCompleted: jobDoneMap[log.jobId] === true,
          completedAt:    job?.completedAt || null,
          logs: [],
          totalDurationMinutes: 0,
          users: new Set(),
          lastActivity: 0,
          runningCount: 0,
          stoppedCount: 0,
        };
      }
      const g = groups[groupKey];
      g.logs.push(log);
      // Use durationSeconds (precise) when available; fall back to rounded durationMinutes
      const logMins = log.durationSeconds != null && log.durationSeconds >= 0
        ? log.durationSeconds / 60
        : (log.durationMinutes || 0);
      g.totalDurationMinutes += logMins;
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
  }, [logs, jobs, jobDoneMap, jobMap, activeTab, dateRange, filterSearch]);

  const totalHours    = groupedLogs.reduce((acc, g) => acc + g.totalDurationMinutes / 60, 0);
  const totalEntries  = groupedLogs.reduce((acc, g) => acc + g.logs.length, 0);

  // Counts for the tab badges (based on JOB status, not log status). Matches
  // the same true/false/orphan rules the tab filter uses — so the count next
  // to "Active Jobs" can never disagree with the rows the tab shows.
  const jobsWithLogs     = useMemo(() => new Set(logs.map(l => l.jobId).filter(Boolean)), [logs]);
  const activeJobCount   = useMemo(() => [...jobsWithLogs].filter(id => jobDoneMap[id] === false).length, [jobsWithLogs, jobDoneMap]);
  const completedJobCount= useMemo(() => [...jobsWithLogs].filter(id => jobDoneMap[id] === true).length, [jobsWithLogs, jobDoneMap]);

  // ── CSV Export ───────────────────────────────────────────────────────────────
  // IMPORTANT: selectedExportJobs is keyed by `internalJobId` (unique Firestore
  // doc id), never by the display id. Two jobs from the same customer with
  // matching PO numbers would otherwise toggle as one entry.
  const openExportModal = () => {
    // Pre-select all jobs by default
    setSelectedExportJobs(new Set(groupedLogs.map(g => g.internalJobId)));
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
    const exportGroups = groupedLogs.filter(g => selectedExportJobs.has(g.internalJobId));
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
        const coName = settings?.companyName?.trim() || 'Shop';
        const title = `${coName} Work Logs — ${drStart} to ${drEnd}`;

        // ── Build rows + track formatting targets ──────────────────
        const rows: any[][] = [];
        const formatRequests: any[] = [];

        // Helper: record row index BEFORE pushing
        const colCount = 13;

        // Rows 0-4: Report header
        rows.push([`${coName.toUpperCase()} — Work Log Export`, ...Array(colCount - 1).fill('')]);
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
              (() => { const m = log.endTime ? getLogDurationMins(log) : undefined; return m != null ? Math.round(m) : ''; })(),
              (() => { const m = log.endTime ? getLogDurationMins(log) : undefined; return m != null ? fmtDur(m) : ''; })(),
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
        const createData = await createRes.json() as {
          spreadsheetId: string;
          spreadsheetUrl: string;
          sheets: Array<{ properties: { sheetId: number } }>;
        };
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
          <h2 className="text-2xl font-bold flex items-center gap-2 text-white"><Calendar className="w-6 h-6 text-amber-500" /> Work Logs</h2>
          <p className="text-zinc-500 text-sm mt-1">Time entries grouped by job. Filter by date, status, or search.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => { setShowBackfill(true); setBfJob(''); setBfJobSearch(''); setBfWorker(''); setBfOp(''); setBfStart(''); setBfEnd(''); }} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-bold transition-all shadow shadow-amber-900/20">
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
          <p className="text-2xl font-bold text-amber-400">{totalHours.toFixed(1)}h</p>
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
          <div className="flex gap-1 col-span-2 sm:col-span-1 flex-wrap">
            {([
              { key: 'today', label: 'Today' },
              { key: 'week',  label: 'Week' },
              { key: 'month', label: 'Month' },
              { key: '90d',   label: '90 Days' },
              { key: 'all',   label: 'All Time' },
            ] as const).map(p => (
              <button key={p.key} onClick={() => setPreset(p.key)} className="flex-1 sm:flex-initial px-3 py-2 text-xs font-bold rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors">{p.label}</button>
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
              className="w-full pl-9 pr-4 py-2 bg-black/30 border border-white/10 rounded-xl text-sm text-white focus:ring-1 focus:ring-amber-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Grouped Logs */}
      <div className="space-y-4">
        {groupedLogs.length === 0 && (
          <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
            <div className="inline-block p-4 rounded-full bg-zinc-800 mb-4"><Filter className="w-8 h-8 text-zinc-600" /></div>
            <p className="font-medium">No logs found in this view.</p>
            <p className="text-sm mt-2 text-zinc-600">
              {logs.length === 0
                ? 'No time has been logged yet — clock into a job to start.'
                : `${logs.length} log${logs.length !== 1 ? 's' : ''} exist outside this filter. Try widening the range or switching tabs.`}
            </p>
            {logs.length > 0 && (
              <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
                <button onClick={() => { setActiveTab('all'); setPreset('all'); }} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg transition-colors">Show All Logs</button>
                <button onClick={() => setPreset('90d')} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-lg transition-colors">Last 90 Days</button>
              </div>
            )}
          </div>
        )}

        {groupedLogs.map(group => (
          <div key={group.internalJobId}
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
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
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
                  const r = settings?.shopRate || 0;
                  if (!r || !group.totalDurationMinutes) return null;
                  const hrs = group.totalDurationMinutes / 60;
                  const ohR = (settings?.monthlyOverhead || 0) / (settings?.monthlyWorkHours || 160);
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
                      <td className="p-3 text-amber-400 font-medium">{log.operation}</td>
                      <td className="p-3 font-mono text-zinc-400 whitespace-nowrap">
                        {new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        <span className="text-zinc-600 mx-1.5" aria-hidden="true">→</span>
                        {log.endTime
                          ? new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : <span className="text-emerald-400 font-bold">Running</span>
                        }
                      </td>
                      <td className="p-3">
                        {log.endTime
                          ? <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-white/10 px-2 py-0.5 rounded-full">Stopped</span>
                          : <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>Live</span>
                        }
                      </td>
                      <td className="p-3 text-right pr-6 font-mono text-zinc-300 font-bold">{formatDuration(getLogDurationMins(log) ?? log.durationMinutes)}</td>
                      <td className="p-3 text-right pr-6 no-print opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button aria-label="Edit log entry" onClick={() => handleEditLog(log)} className="text-zinc-500 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors" title="Edit log"><Edit2 className="w-3 h-3" aria-hidden="true" /></button>
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
        <Overlay open onClose={closeEditModal} ariaLabel="Edit time log" zIndex={200}>
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-800/50 sticky top-0 z-10">
              <h3 className="font-bold text-white flex items-center gap-2"><Edit2 className="w-4 h-4 text-amber-500" /> Edit Time Log</h3>
              <button aria-label="Close dialog" onClick={closeEditModal} className="p-2 rounded-lg hover:bg-white/5 transition-colors"><X className="w-5 h-5 text-zinc-500 hover:text-white" aria-hidden="true" /></button>
            </div>
            {/* Job context strip — always shows WHICH job this log belongs to
                so the user can confirm they're editing the right row. */}
            {(() => {
              const parentJob = jobMap[editingLog.jobId];
              const poNumber = parentJob?.poNumber || editingLog.jobIdsDisplay || editingLog.jobId;
              const partNumber = parentJob?.partNumber || editingLog.partNumber || '';
              const customer = parentJob?.customer || editingLog.customer || '';
              return (
                <div className="px-6 py-3 bg-amber-500/5 border-b border-amber-500/15 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                    <Briefcase className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Job</p>
                    <p className="text-sm font-bold text-white truncate tabular">
                      {poNumber}
                      {partNumber && <span className="text-zinc-400 font-normal"> · {partNumber}</span>}
                      {customer && <span className="text-zinc-500 font-normal"> · {customer}</span>}
                    </p>
                  </div>
                </div>
              );
            })()}
            <div className="p-6 space-y-5">
              <div>
                <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Employee</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                  value={editingLog.userId}
                  onChange={e => {
                    const u = users.find(u => u.id === e.target.value);
                    if (u) setEditingLog({ ...editingLog, userId: u.id, userName: u.name });
                  }}>
                  {/* Fallback option when the log's userId is no longer in the users list
                      (e.g. user was deleted or renamed). Prevents the select showing blank. */}
                  {!users.find(u => u.id === editingLog.userId) && (
                    <option value={editingLog.userId}>{editingLog.userName || editingLog.userId || '(Unknown Employee)'}</option>
                  )}
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Operation</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:ring-2 focus:ring-amber-500 outline-none"
                  value={editingLog.operation}
                  onChange={e => setEditingLog({ ...editingLog, operation: e.target.value })}>
                  {ops.map(o => <option key={o} value={o}>{o}</option>)}
                  {!ops.includes(editingLog.operation) && <option value={editingLog.operation}>{editingLog.operation} (Legacy)</option>}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">Start Time</label>
                  <input
                    type="datetime-local"
                    step="60"
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                    value={editStartStr}
                    onChange={e => setEditStartStr(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 uppercase font-bold mb-1 block">End Time</label>
                  <input
                    type="datetime-local"
                    step="60"
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white text-sm"
                    value={editEndStr}
                    onChange={e => setEditEndStr(e.target.value)}
                  />
                  <p className="text-[10px] text-zinc-500 mt-1">Clear to mark as active.</p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-white/10 bg-zinc-800/50 flex justify-between items-center sticky bottom-0 z-10">
              <button onClick={handleDeleteLog} className="text-red-500 hover:text-red-400 text-sm font-bold flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors"><Trash2 className="w-4 h-4" /> Delete Log</button>
              <div className="flex gap-2">
                <button onClick={closeEditModal} className="px-4 py-2 text-zinc-400 hover:text-white">Cancel</button>
                <button onClick={handleSaveLog} disabled={savingLog} className="bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-white px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 min-w-[120px] justify-center">
                  {savingLog ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Saving…</span></> : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Backfill Entry Modal ──────────────────────────────────── */}
      {showBackfill && (
        <Overlay open onClose={() => setShowBackfill(false)} ariaLabel="Backfill time entry" zIndex={200} padding="p-0 sm:p-4">
          <div className="bg-zinc-900 border border-white/10 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col my-0 sm:my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div><h3 className="text-lg font-bold text-white flex items-center gap-2"><Clock className="w-5 h-5 text-amber-400" /> Backfill Time Entry</h3><p className="text-sm text-zinc-400 mt-0.5">Add a past entry for a worker who forgot to scan</p></div>
              <button onClick={() => setShowBackfill(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-4">
              <div>
                <label className="text-xs font-bold text-zinc-500 uppercase block mb-1">Job</label>
                {bfJob ? (() => {
                  const sel = jobs.find(j => j.id === bfJob);
                  return sel ? (
                    <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
                      <div>
                        <p className="font-black text-white text-sm">PO {sel.poNumber}</p>
                        <p className="text-xs text-zinc-400 mt-0.5">{sel.partNumber}{sel.customer ? ` · ${sel.customer}` : ''}{sel.quantity ? ` · Qty ${sel.quantity}` : ''}</p>
                      </div>
                      <button onClick={() => { setBfJob(''); setBfJobSearch(''); }} className="ml-3 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors" title="Change job">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : null;
                })() : (
                  <div className="relative">
                    <div className="relative">
                      <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-3.5 pointer-events-none" />
                      <input
                        autoFocus
                        placeholder="Search PO#, part#, customer…"
                        value={bfJobSearch}
                        onChange={e => setBfJobSearch(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl p-3 pl-9 text-white text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                    </div>
                    <div className="mt-1.5 rounded-xl border border-white/10 overflow-hidden bg-zinc-950 max-h-44 overflow-y-auto">
                      {(() => {
                        const q = bfJobSearch.toLowerCase().trim();
                        const filtered = jobs
                          .filter(j => j.status !== 'completed')
                          .filter(j => !q || (j.poNumber||'').toLowerCase().includes(q) || (j.partNumber||'').toLowerCase().includes(q) || (j.customer||'').toLowerCase().includes(q))
                          .slice(0, 15);
                        if (filtered.length === 0) return (
                          <div className="px-4 py-3 text-zinc-500 text-sm text-center">No active jobs found{q ? ` matching "${q}"` : ''}</div>
                        );
                        return filtered.map((j, idx) => (
                          <button
                            key={j.id}
                            onClick={() => { setBfJob(j.id); setBfJobSearch(''); }}
                            className={`w-full text-left px-4 py-2.5 hover:bg-white/10 transition-colors flex items-center justify-between gap-2 ${idx > 0 ? 'border-t border-white/5' : ''}`}
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-white text-sm truncate">PO {j.poNumber}</p>
                              <p className="text-xs text-zinc-500 truncate">{j.partNumber}{j.customer ? ` · ${j.customer}` : ''}</p>
                            </div>
                            {j.quantity ? <span className="shrink-0 text-[10px] font-bold text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">Qty {j.quantity}</span> : null}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}
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
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
                  <span className="text-amber-400 font-bold">{((new Date(bfEnd).getTime() - new Date(bfStart).getTime()) / 3600000).toFixed(1)}h</span>
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
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:opacity-30 text-white font-bold text-sm transition-all"
              >
                Save Entry
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* ── Export CSV Modal ─────────────────────────────────────────── */}
      {showExportModal && (
        <Overlay open onClose={() => setShowExportModal(false)} ariaLabel="Export work logs" zIndex={200}>
          <div className="bg-zinc-900 border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl flex flex-col my-4" style={{ maxHeight: 'calc(100dvh - 2rem)' }}>
            {/* Header */}
            <div className="p-5 border-b border-white/10 flex justify-between items-center bg-zinc-800/50 sticky top-0 z-10">
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
                    onClick={() => setSelectedExportJobs(new Set(groupedLogs.map(g => g.internalJobId)))}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-bold"
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
                  const checked = selectedExportJobs.has(group.internalJobId);
                  return (
                    <label
                      key={group.internalJobId}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        checked
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-zinc-800/50 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleExportJob(group.internalJobId)}
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
                const sel = groupedLogs.filter(g => selectedExportJobs.has(g.internalJobId));
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
        </Overlay>
      )}
    </div>
  );
};
