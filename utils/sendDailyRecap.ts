// utils/sendDailyRecap.ts
// ═════════════════════════════════════════════════════════════════════
// Builds and delivers the end-of-day shop recap email.
//
// Recap includes:
//   • Worker breakdown: name, total hours, sessions, operations
//   • Jobs completed today: PO#, customer, part, revenue
//   • Job Insights: current pace vs last historical run (per piece)
//     — e.g. "800pcs now at 22h (0.0275h/pc) vs last run 1000pcs 19h (0.019h/pc) — 45% slower"
//   • Shop totals: hours, workers, revenue, open rework
//
// Exported:
//   buildRecapHtml(data)    → HTML string
//   sendDailyRecap(opts)    → Promise<{ ok, error? }>
// ═════════════════════════════════════════════════════════════════════

import type { TimeLog, Job, User } from '../types';
import { getPartHistory } from './partHistory';

// ── Helpers ───────────────────────────────────────────────────────────

function logMins(l: TimeLog): number {
  if (l.durationSeconds != null && l.durationSeconds >= 0) return l.durationSeconds / 60;
  return l.durationMinutes || 0;
}

function fmtHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtHoursExact(h: number): string {
  return h < 0.1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`;
}

function fmtHpu(hpu: number): string {
  // hours-per-unit — show as min/pc when < 0.1h/pc
  if (hpu < 0.0167) return `${Math.round(hpu * 3600)}s/pc`;
  if (hpu < 0.1667) return `${Math.round(hpu * 60)}m/pc`;
  return `${hpu.toFixed(3)}h/pc`;
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n: number): string {
  return n.toLocaleString('en-US');
}

function relativeDate(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

function todayBounds(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { start, end: start + 86_400_000 - 1 };
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ── Types ─────────────────────────────────────────────────────────────

export interface WorkerSummary {
  userId: string;
  name: string;
  totalMins: number;
  sessions: number;
  operations: string[];
  jobs: string[];
}

export interface JobInsight {
  jobId: string;
  poNumber: string;
  partNumber: string;
  customer: string;
  currentQty: number;
  currentHours: number;         // hours logged so far on this job
  currentHpu: number;           // hours-per-unit so far
  isComplete: boolean;          // completed today vs still open
  // Historical comparison — null if no prior runs
  lastRunQty: number | null;
  lastRunHours: number | null;
  lastRunHpu: number | null;
  lastRunDate: number | null;   // completedAt of last run
  avgHpu: number | null;        // average across ALL prior runs
  totalPriorRuns: number;
  deltaPct: number | null;      // % change vs avgHpu; positive = slower, negative = faster
  deltaVsLastPct: number | null;// % change vs lastRun specifically
}

export interface RecapData {
  shopName: string;
  date: number;
  workerSummaries: WorkerSummary[];
  completedToday: Job[];
  totalMins: number;
  totalRevenue: number;
  openReworkCount: number;
  activeWorkersToday: number;
  jobInsights: JobInsight[];
}

export interface RecapOptions {
  to: string;                   // primary recipient
  ccEmails?: string[];          // additional recipients
  logs: TimeLog[];              // ALL time logs (completed + in-progress)
  allJobs: Job[];               // ALL jobs — open + completed (for part history + open job lookup)
  users: User[];
  shopName: string;
  shopRate?: number;
  openReworkCount?: number;
  /** Override "today" start timestamp (UTC ms). When omitted, uses local midnight.
   *  Pass this from server-side functions to get timezone-correct day boundaries. */
  todayStart?: number;
}

// ── Core data builder ─────────────────────────────────────────────────

export function buildRecapData(opts: RecapOptions): RecapData {
  const { start, end } = opts.todayStart
    ? { start: opts.todayStart, end: opts.todayStart + 86_400_000 - 1 }
    : todayBounds();
  const completedLogs = opts.logs.filter(l => l.endTime);
  const todayLogs = completedLogs.filter(l => l.endTime! >= start && l.endTime! <= end);

  // ── Worker summaries ────────────────────────────────────────────────
  const workerMap = new Map<string, WorkerSummary>();
  for (const l of todayLogs) {
    const mins = logMins(l);
    if (mins <= 0) continue;
    let w = workerMap.get(l.userId);
    if (!w) {
      const user = opts.users.find(u => u.id === l.userId);
      w = { userId: l.userId, name: l.userName || user?.name || 'Unknown', totalMins: 0, sessions: 0, operations: [], jobs: [] };
      workerMap.set(l.userId, w);
    }
    w.totalMins += mins;
    w.sessions += 1;
    if (l.operation && !w.operations.includes(l.operation)) w.operations.push(l.operation);
    if (l.jobId && !w.jobs.includes(l.jobId)) w.jobs.push(l.jobId);
  }
  const workerSummaries = [...workerMap.values()].sort((a, b) => b.totalMins - a.totalMins);

  // ── Completed today ─────────────────────────────────────────────────
  const completedJobs = opts.allJobs.filter(j => j.status === 'completed');
  const completedToday = completedJobs.filter(j => j.completedAt && j.completedAt >= start && j.completedAt <= end);

  const totalMins = workerSummaries.reduce((a, w) => a + w.totalMins, 0);
  const totalRevenue = completedToday.reduce((a, j) => a + (j.quoteAmount && j.quoteAmount > 0 ? j.quoteAmount : 0), 0);

  // ── Job insights: compare pace vs history ──────────────────────────
  // Find all unique jobs that had time logged today
  const todayJobIds = [...new Set(todayLogs.map(l => l.jobId).filter(Boolean))];
  const jobInsights: JobInsight[] = [];

  for (const jobId of todayJobIds) {
    const job = opts.allJobs.find(j => j.id === jobId);
    if (!job || !job.partNumber?.trim()) continue;
    // Skip zero-quantity jobs — hours-per-unit math is meaningless and misleading
    if (!job.quantity || job.quantity <= 0) continue;

    // Hours logged on this job today + all time (for current pace)
    // Use ALL logs for this job (not just today) to get full picture of where it stands
    const allJobLogs = completedLogs.filter(l => l.jobId === jobId);
    const currentMins = allJobLogs.reduce((a, l) => a + logMins(l), 0);
    const currentHours = currentMins / 60;
    const currentHpu = job.quantity > 0 ? currentHours / job.quantity : 0;

    // History: use completed jobs EXCLUDING this one
    const otherCompleted = completedJobs.filter(j => j.id !== jobId);
    const history = getPartHistory(job.partNumber, otherCompleted, completedLogs);

    const isComplete = job.status === 'completed' && !!(job.completedAt && job.completedAt >= start);

    // Skip if no logged time worth showing
    if (currentHours < 0.05) continue;

    if (!history || history.totalRuns === 0) {
      // First time running this part — still show as insight with no comparison
      jobInsights.push({
        jobId,
        poNumber: job.poNumber || jobId.slice(-6).toUpperCase(),
        partNumber: job.partNumber,
        customer: job.customer || '—',
        currentQty: job.quantity,
        currentHours,
        currentHpu,
        isComplete,
        lastRunQty: null, lastRunHours: null, lastRunHpu: null, lastRunDate: null,
        avgHpu: null, totalPriorRuns: 0,
        deltaPct: null, deltaVsLastPct: null,
      });
      continue;
    }

    const lastRun = history.lastRun;
    const deltaVsLastPct = lastRun && lastRun.hoursPerUnit > 0 && currentHpu > 0
      ? ((currentHpu - lastRun.hoursPerUnit) / lastRun.hoursPerUnit) * 100
      : null;
    const deltaPct = history.avgHoursPerUnit > 0 && currentHpu > 0
      ? ((currentHpu - history.avgHoursPerUnit) / history.avgHoursPerUnit) * 100
      : null;

    jobInsights.push({
      jobId,
      poNumber: job.poNumber || jobId.slice(-6).toUpperCase(),
      partNumber: job.partNumber,
      customer: job.customer || '—',
      currentQty: job.quantity,
      currentHours,
      currentHpu,
      isComplete,
      lastRunQty: lastRun?.quantity ?? null,
      lastRunHours: lastRun?.totalHours ?? null,
      lastRunHpu: lastRun?.hoursPerUnit ?? null,
      lastRunDate: lastRun?.completedAt ?? null,
      avgHpu: history.avgHoursPerUnit,
      totalPriorRuns: history.totalRuns,
      deltaPct,
      deltaVsLastPct,
    });
  }

  // Sort insights: biggest delta (worst performance) first, then first-timers, then on-pace
  jobInsights.sort((a, b) => {
    const da = Math.abs(a.deltaVsLastPct ?? a.deltaPct ?? 0);
    const db = Math.abs(b.deltaVsLastPct ?? b.deltaPct ?? 0);
    return db - da;
  });

  return {
    shopName: opts.shopName,
    date: Date.now(),
    workerSummaries,
    completedToday,
    totalMins,
    totalRevenue,
    openReworkCount: opts.openReworkCount ?? 0,
    activeWorkersToday: workerSummaries.length,
    jobInsights,
  };
}

// ── HTML builder ───────────────────────────────────────────────────────

function insightBadge(pct: number | null): string {
  if (pct === null) return '';
  const abs = Math.abs(pct);
  if (abs < 8) return `<span style="background:#166534;color:#86efac;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:800;">≈ On Pace</span>`;
  if (pct > 0) {
    const color = abs > 30 ? '#7f1d1d' : '#431407';
    const text  = abs > 30 ? '#fca5a5' : '#fdba74';
    return `<span style="background:${color};color:${text};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:800;">▲ ${Math.round(abs)}% SLOWER</span>`;
  }
  return `<span style="background:#14532d;color:#4ade80;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:800;">▼ ${Math.round(abs)}% FASTER</span>`;
}

export function buildRecapHtml(data: RecapData): string {
  const { shopName, date, workerSummaries, completedToday, totalMins, totalRevenue, openReworkCount, jobInsights } = data;

  // ── Worker rows
  const workerRows = workerSummaries.map(w => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #27272a;color:#fff;font-weight:700;">${w.name}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #27272a;color:#f59e0b;font-weight:800;text-align:right;white-space:nowrap;">${fmtHours(w.totalMins)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #27272a;color:#71717a;font-size:13px;">${w.sessions} session${w.sessions !== 1 ? 's' : ''}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #27272a;color:#a1a1aa;font-size:12px;">${w.operations.slice(0, 3).join(', ')}</td>
    </tr>
  `).join('');

  // ── Completed job rows
  const jobRows = completedToday.map(j => `
    <tr>
      <td style="padding:8px 16px;border-bottom:1px solid #27272a;color:#fff;font-weight:700;">${j.poNumber || j.id.slice(-6).toUpperCase()}</td>
      <td style="padding:8px 16px;border-bottom:1px solid #27272a;color:#a1a1aa;">${j.customer || '—'}</td>
      <td style="padding:8px 16px;border-bottom:1px solid #27272a;color:#a1a1aa;">${j.partNumber || '—'}</td>
      <td style="padding:8px 16px;border-bottom:1px solid #27272a;color:#10b981;font-weight:700;text-align:right;">${j.quoteAmount ? fmtMoney(j.quoteAmount) : '—'}</td>
    </tr>
  `).join('');

  // ── Insight cards
  const insightCards = jobInsights.map(ins => {
    const badge = insightBadge(ins.deltaVsLastPct ?? ins.deltaPct);
    const statusDot = ins.isComplete
      ? `<span style="color:#10b981;font-size:11px;font-weight:700;">✓ DONE TODAY</span>`
      : `<span style="color:#f59e0b;font-size:11px;font-weight:700;">● IN PROGRESS</span>`;

    const hasHistory = ins.lastRunHpu !== null;

    let comparisonHtml = '';
    if (hasHistory && ins.lastRunQty !== null && ins.lastRunHours !== null && ins.lastRunDate !== null) {
      comparisonHtml = `
        <div style="margin-top:8px;padding:10px 14px;background:#09090b;border-radius:8px;border-left:3px solid ${(ins.deltaVsLastPct ?? 0) > 15 ? '#f97316' : (ins.deltaVsLastPct ?? 0) < -8 ? '#10b981' : '#3f3f46'};">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;">Last Run — ${relativeDate(ins.lastRunDate)}</p>
          <p style="margin:0;font-size:13px;color:#a1a1aa;">
            ${fmtQty(ins.lastRunQty)} pcs &nbsp;·&nbsp; <strong style="color:#e4e4e7;">${fmtHoursExact(ins.lastRunHours)}</strong> total &nbsp;·&nbsp; <strong style="color:#e4e4e7;">${fmtHpu(ins.lastRunHpu!)}</strong>
          </p>
          ${ins.totalPriorRuns > 1 ? `<p style="margin:4px 0 0;font-size:11px;color:#52525b;">Avg across ${ins.totalPriorRuns} prior runs: ${fmtHpu(ins.avgHpu!)}</p>` : ''}
        </div>
      `;
    } else if (!hasHistory) {
      comparisonHtml = `
        <div style="margin-top:8px;padding:8px 14px;background:#09090b;border-radius:8px;">
          <p style="margin:0;font-size:12px;color:#52525b;font-style:italic;">First time running this part — no historical data yet.</p>
        </div>
      `;
    }

    return `
      <div style="border:1px solid #27272a;border-radius:12px;overflow:hidden;margin-bottom:10px;">
        <div style="padding:12px 16px;background:#1c1c1e;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div>
              <span style="font-size:13px;font-weight:800;color:#fff;">${ins.partNumber}</span>
              <span style="font-size:12px;color:#71717a;margin-left:8px;">${ins.customer}</span>
              <span style="font-size:11px;color:#52525b;margin-left:6px;">PO ${ins.poNumber}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">${statusDot} ${badge}</div>
          </div>
          <div style="margin-top:8px;">
            <p style="margin:0;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;">Current Run</p>
            <p style="margin:4px 0 0;font-size:14px;color:#e4e4e7;">
              <strong style="color:#fff;">${fmtQty(ins.currentQty)} pcs</strong>
              &nbsp;·&nbsp; <strong style="color:#f59e0b;">${fmtHoursExact(ins.currentHours)}</strong> logged
              &nbsp;·&nbsp; <strong style="color:#f59e0b;">${fmtHpu(ins.currentHpu)}</strong>
            </p>
          </div>
          ${comparisonHtml}
        </div>
      </div>
    `;
  }).join('');

  const hasJobs      = completedToday.length > 0;
  const hasWorkers   = workerSummaries.length > 0;
  const hasInsights  = jobInsights.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Recap — ${shopName}</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;">
    <tr><td align="center" style="padding:32px 12px 48px;">

      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#18181b;border-radius:16px;border:1px solid #27272a;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#92400e,#b45309,#d97706);padding:28px 32px 24px;">
            <p style="margin:0 0 3px;font-size:10px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:#fcd34d;opacity:0.9;">Daily Recap</p>
            <h1 style="margin:0 0 4px;font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.02em;">${shopName}</h1>
            <p style="margin:0;font-size:13px;color:#fde68a;opacity:0.8;">${formatDate(date)}</p>
          </td>
        </tr>

        <!-- Stats strip -->
        <tr>
          <td style="padding:0;border-bottom:1px solid #27272a;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:18px 20px;text-align:center;border-right:1px solid #27272a;">
                  <p style="margin:0 0 3px;font-size:26px;font-weight:900;color:#f59e0b;letter-spacing:-0.03em;">${fmtHours(totalMins)}</p>
                  <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;">Hours</p>
                </td>
                <td style="padding:18px 20px;text-align:center;border-right:1px solid #27272a;">
                  <p style="margin:0 0 3px;font-size:26px;font-weight:900;color:#10b981;letter-spacing:-0.03em;">${data.activeWorkersToday}</p>
                  <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;">Workers</p>
                </td>
                <td style="padding:18px 20px;text-align:center;border-right:1px solid #27272a;">
                  <p style="margin:0 0 3px;font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.03em;">${completedToday.length}</p>
                  <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;">Jobs Done</p>
                </td>
                <td style="padding:18px 20px;text-align:center;">
                  <p style="margin:0 0 3px;font-size:26px;font-weight:900;color:${openReworkCount > 0 ? '#f97316' : '#10b981'};letter-spacing:-0.03em;">${openReworkCount}</p>
                  <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#52525b;">Rework</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Revenue -->
        ${totalRevenue > 0 ? `
        <tr>
          <td style="padding:14px 28px;border-bottom:1px solid #27272a;background:#0d1f13;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:#6ee7b7;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Revenue Generated Today</td>
                <td style="text-align:right;font-size:20px;font-weight:900;color:#34d399;letter-spacing:-0.02em;">${fmtMoney(totalRevenue)}</td>
              </tr>
            </table>
          </td>
        </tr>
        ` : ''}

        <!-- ── JOB INSIGHTS ── -->
        ${hasInsights ? `
        <tr>
          <td style="padding:22px 28px 8px;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#71717a;">Job Insights</p>
            <p style="margin:0 0 14px;font-size:12px;color:#52525b;">Current pace vs last run — same part, different quantity</p>
            ${insightCards}
          </td>
        </tr>
        ` : ''}

        <!-- Worker breakdown -->
        <tr><td style="padding:22px 28px 8px;${hasInsights ? 'border-top:1px solid #27272a;' : ''}">
          <p style="margin:0 0 12px;font-size:10px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#71717a;">Worker Breakdown</p>
        </td></tr>
        <tr>
          <td style="padding:0 12px 20px;">
            ${hasWorkers ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;border:1px solid #27272a;">
              <thead><tr style="background:#27272a;">
                <th style="padding:7px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Worker</th>
                <th style="padding:7px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Time</th>
                <th style="padding:7px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Sessions</th>
                <th style="padding:7px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Operations</th>
              </tr></thead>
              <tbody>${workerRows}</tbody>
            </table>
            ` : `<p style="color:#52525b;font-size:14px;text-align:center;padding:16px 0;">No time logged today.</p>`}
          </td>
        </tr>

        <!-- Completed jobs -->
        ${hasJobs ? `
        <tr><td style="padding:4px 28px 8px;border-top:1px solid #27272a;">
          <p style="margin:16px 0 12px;font-size:10px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#71717a;">Jobs Completed Today</p>
        </td></tr>
        <tr>
          <td style="padding:0 12px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;overflow:hidden;border:1px solid #27272a;">
              <thead><tr style="background:#27272a;">
                <th style="padding:7px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">PO #</th>
                <th style="padding:7px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Customer</th>
                <th style="padding:7px 16px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Part No.</th>
                <th style="padding:7px 16px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Revenue</th>
              </tr></thead>
              <tbody>${jobRows}</tbody>
            </table>
          </td>
        </tr>
        ` : ''}

        <!-- Footer -->
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #27272a;text-align:center;">
            <p style="margin:0;font-size:12px;color:#3f3f46;">
              <strong style="color:#71717a;">FabTrack IO</strong>
              &nbsp;·&nbsp;
              <a href="https://app.fabtrack.io" style="color:#f59e0b;text-decoration:none;">Open Dashboard</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Plain text fallback ───────────────────────────────────────────────

export function buildRecapText(data: RecapData): string {
  const { shopName, date, workerSummaries, completedToday, totalMins, totalRevenue, openReworkCount, jobInsights } = data;
  const lines: string[] = [
    `DAILY RECAP — ${shopName}`,
    formatDate(date),
    '═'.repeat(44),
    '',
    `Total hours: ${fmtHours(totalMins)}  |  Workers: ${data.activeWorkersToday}  |  Jobs done: ${completedToday.length}  |  Rework: ${openReworkCount}`,
    ...(totalRevenue > 0 ? [`Revenue: ${fmtMoney(totalRevenue)}`] : []),
    '',
  ];

  if (jobInsights.length > 0) {
    lines.push('── JOB INSIGHTS ──', '');
    for (const ins of jobInsights) {
      const status = ins.isComplete ? '✓ done' : '● active';
      lines.push(`  ${ins.partNumber} (${ins.customer}) — PO ${ins.poNumber} [${status}]`);
      lines.push(`    Now: ${fmtQty(ins.currentQty)} pcs · ${fmtHoursExact(ins.currentHours)} logged · ${fmtHpu(ins.currentHpu)}`);
      if (ins.lastRunHpu !== null && ins.lastRunQty !== null && ins.lastRunHours !== null) {
        const ago = ins.lastRunDate ? ` (${relativeDate(ins.lastRunDate)})` : '';
        lines.push(`    Last run${ago}: ${fmtQty(ins.lastRunQty)} pcs · ${fmtHoursExact(ins.lastRunHours)} · ${fmtHpu(ins.lastRunHpu)}`);
        if (ins.deltaVsLastPct !== null) {
          const dir = ins.deltaVsLastPct > 0 ? `▲ ${Math.round(ins.deltaVsLastPct)}% SLOWER` : `▼ ${Math.round(Math.abs(ins.deltaVsLastPct))}% FASTER`;
          lines.push(`    ${dir} per piece vs last run`);
        }
      } else {
        lines.push('    First time running this part — no comparison yet');
      }
      lines.push('');
    }
  }

  lines.push('── WORKERS ──');
  for (const w of workerSummaries) {
    lines.push(`  ${w.name}: ${fmtHours(w.totalMins)} (${w.sessions} session${w.sessions !== 1 ? 's' : ''}) — ${w.operations.slice(0, 3).join(', ')}`);
  }

  if (completedToday.length > 0) {
    lines.push('', '── JOBS COMPLETED TODAY ──');
    for (const j of completedToday) {
      lines.push(`  ${j.poNumber || '—'} · ${j.customer || '—'} · ${j.partNumber || '—'}${j.quoteAmount ? ` · ${fmtMoney(j.quoteAmount)}` : ''}`);
    }
  }

  lines.push('', 'FabTrack IO · https://app.fabtrack.io');
  return lines.join('\n');
}

// ── Sender ────────────────────────────────────────────────────────────

export async function sendDailyRecap(opts: RecapOptions): Promise<{ ok: boolean; error?: string }> {
  if (!opts.to?.trim()) return { ok: false, error: 'No recipient email configured.' };

  const data = buildRecapData(opts);
  const html = buildRecapHtml(data);
  const text = buildRecapText(data);

  const workerNames = data.workerSummaries.map(w => w.name).join(', ');
  const subject = `Daily Recap — ${data.shopName} — ${new Date(data.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${workerNames ? ` · ${workerNames}` : ''}`;

  // Build recipient list: primary + any CC
  const toAddresses = [opts.to.trim(), ...(opts.ccEmails?.map(e => e.trim()).filter(Boolean) ?? [])];

  try {
    const res = await fetch('/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toAddresses, subject, html, text }),
    });
    const result = await res.json() as any;
    if (!res.ok) return { ok: false, error: result?.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}
