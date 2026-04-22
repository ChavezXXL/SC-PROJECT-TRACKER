// ═════════════════════════════════════════════════════════════════════
// Client Update Generator — deterministic "no-AI" template engine.
//
// Takes a customer + a list of their jobs, runs them through a template
// with variable placeholders, and produces plain text ready to paste
// into an email or text message.
//
// Why no AI:
//   • Zero cost per message
//   • 100% deterministic — same inputs always produce same output
//   • Offline-safe
//   • No data leaves the shop
//
// Templates support these placeholders (case-sensitive):
//   {{customer}}          — customer name
//   {{contact}}           — contact person (or customer name if unknown)
//   {{shop}}              — our shop name (settings.companyName)
//   {{shopPhone}}         — our phone
//   {{user}}              — person generating this message
//   {{date}}              — today, formatted MM/DD/YYYY
//   {{jobCount}}          — number of selected jobs
//   {{jobList}}           — pretty multi-line list (default format)
//   {{jobListShort}}      — one line per job, no blank between
//   {{jobTable}}          — PO · Part · Due · Stage (plain text table)
//   {{urgentList}}        — only jobs marked urgent, same format as jobList
//   {{overdueList}}       — only jobs past due
//   {{readyList}}         — only jobs completed or shipped in the last 7 days
// ═════════════════════════════════════════════════════════════════════

import type { Job, JobStage, SystemSettings } from '../types';
import { getJobStage } from '../App';
import { fmt, dateNum, todayFmt } from './date';

export interface ClientUpdateContext {
  customer: string;
  contact?: string;
  jobs: Job[];
  settings: SystemSettings;
  stages: JobStage[];
  userName: string;
}

// ── Pre-canned templates ─────────────────────────────────────────────
// Shops can save their own (stored in settings), but these cover 80% of
// common outgoing client messages.

export interface ClientUpdateTemplate {
  id: string;
  label: string;
  /** When included, only jobs meeting this filter are substituted into
   *  list/table placeholders. Useful for "delay notice" / "ready to ship". */
  filter?: 'all' | 'urgent' | 'overdue' | 'ready' | 'open';
  subject?: string;
  body: string;
}

export const BUILT_IN_TEMPLATES: ClientUpdateTemplate[] = [
  {
    id: 'status-update',
    label: 'Status Update',
    subject: 'Job status — {{jobCount}} open job{{s}}',
    body:
`Hi {{contact}},

Quick status on your {{jobCount}} open job{{s}} with {{shop}}:

{{jobList}}

Let me know if you need photos, certs, or anything else.

Thanks,
{{user}}
{{shop}}
{{shopPhone}}`,
  },
  {
    id: 'weekly-summary',
    label: 'Weekly Summary',
    filter: 'open',
    subject: 'Weekly update from {{shop}}',
    body:
`Hi {{contact}},

Here's this week's snapshot on your work with {{shop}}:

{{jobTable}}

As always, reach out with questions.

— {{user}}`,
  },
  {
    id: 'delay-notice',
    label: 'Delay Notice',
    filter: 'overdue',
    subject: 'Heads up on {{jobCount}} job{{s}}',
    body:
`Hi {{contact}},

Want to get in front of this — the following job{{s}} are running behind our original due date{{s}}:

{{jobList}}

I'll have a revised ETA to you shortly. Apologies for the delay — we're working on it.

{{user}}
{{shop}}`,
  },
  {
    id: 'ready-to-ship',
    label: 'Ready to Ship',
    filter: 'ready',
    subject: 'Ready for pickup / shipment',
    body:
`Hi {{contact}},

Good news — the following job{{s}} are complete and ready:

{{jobList}}

Let me know if you'd like us to arrange freight or if you're picking up. Thanks!

{{user}}
{{shop}}`,
  },
  {
    id: 'short',
    label: 'Short & Sweet',
    body:
`Hi {{contact}}, quick update on your {{jobCount}} job{{s}}:

{{jobListShort}}

— {{user}}`,
  },
];

// ── Rendering helpers ────────────────────────────────────────────────

function jobLabel(job: Job): string {
  const qty = job.quantity ? ` × ${job.quantity}` : '';
  return `${job.partNumber}${qty}`;
}

function stageName(job: Job, stages: JobStage[]): string {
  const s = getJobStage(job, stages);
  return s?.label || 'Pending';
}

function etaNote(job: Job): string {
  if (!job.dueDate) return 'no due date';
  const due = dateNum(job.dueDate);
  const today = dateNum(todayFmt());
  if (due < today) return `overdue since ${fmt(job.dueDate)}`;
  const daysOut = Math.round((new Date(job.dueDate).getTime() - Date.now()) / 86_400_000);
  if (daysOut <= 0) return `due today`;
  if (daysOut <= 3) return `due ${fmt(job.dueDate)} · ${daysOut}d left`;
  return `due ${fmt(job.dueDate)}`;
}

function filterJobs(jobs: Job[], stages: JobStage[], filter?: ClientUpdateTemplate['filter']): Job[] {
  if (!filter || filter === 'all') return jobs;
  const today = dateNum(todayFmt());
  const weekAgo = Date.now() - 7 * 86_400_000;
  switch (filter) {
    case 'urgent':  return jobs.filter(j => j.priority === 'urgent');
    case 'overdue': return jobs.filter(j => j.status !== 'completed' && j.dueDate && dateNum(j.dueDate) < today);
    case 'ready':   return jobs.filter(j => j.status === 'completed' && (j.completedAt || 0) >= weekAgo);
    case 'open':    return jobs.filter(j => j.status !== 'completed');
  }
}

/** Build the jobList / jobTable / jobListShort strings. */
function buildJobFormats(jobs: Job[], stages: JobStage[]): { list: string; listShort: string; table: string } {
  if (jobs.length === 0) {
    return { list: '(none)', listShort: '(none)', table: '(none)' };
  }
  const list = jobs.map(j => {
    const lines = [
      `📦 PO ${j.poNumber} — ${jobLabel(j)}`,
      `   Stage: ${stageName(j, stages)}`,
      `   ${etaNote(j)}`,
    ];
    return lines.join('\n');
  }).join('\n\n');

  const listShort = jobs.map(j => `• PO ${j.poNumber} · ${jobLabel(j)} · ${stageName(j, stages)} · ${etaNote(j)}`).join('\n');

  // Plain-text aligned table — widths auto-fit to longest column.
  const rows = jobs.map(j => ({
    po: j.poNumber || '',
    part: jobLabel(j),
    due: j.dueDate ? fmt(j.dueDate) : '—',
    stage: stageName(j, stages),
  }));
  const widths = {
    po: Math.max(2, ...rows.map(r => r.po.length)),
    part: Math.max(4, ...rows.map(r => r.part.length)),
    due: Math.max(3, ...rows.map(r => r.due.length)),
    stage: Math.max(5, ...rows.map(r => r.stage.length)),
  };
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const header = `${pad('PO', widths.po)}  ${pad('Part', widths.part)}  ${pad('Due', widths.due)}  ${pad('Stage', widths.stage)}`;
  const sep = `${'─'.repeat(widths.po)}  ${'─'.repeat(widths.part)}  ${'─'.repeat(widths.due)}  ${'─'.repeat(widths.stage)}`;
  const body = rows.map(r => `${pad(r.po, widths.po)}  ${pad(r.part, widths.part)}  ${pad(r.due, widths.due)}  ${pad(r.stage, widths.stage)}`).join('\n');
  const table = [header, sep, body].join('\n');

  return { list, listShort, table };
}

/** Replace all {{placeholders}} in a template string. */
export function renderClientUpdate(template: ClientUpdateTemplate, ctx: ClientUpdateContext): { subject: string; body: string } {
  const filteredJobs = filterJobs(ctx.jobs, ctx.stages, template.filter);
  const { list, listShort, table } = buildJobFormats(filteredJobs, ctx.stages);
  const urgent = filterJobs(ctx.jobs, ctx.stages, 'urgent');
  const overdue = filterJobs(ctx.jobs, ctx.stages, 'overdue');
  const ready = filterJobs(ctx.jobs, ctx.stages, 'ready');

  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const count = filteredJobs.length;

  const vars: Record<string, string> = {
    customer: ctx.customer,
    contact: ctx.contact || ctx.customer || 'there',
    shop: ctx.settings.companyName || 'our shop',
    shopPhone: ctx.settings.companyPhone || '',
    user: ctx.userName,
    date: today,
    jobCount: String(count),
    s: count === 1 ? '' : 's',              // optional pluralizer: "{{jobCount}} job{{s}}"
    jobList: list,
    jobListShort: listShort,
    jobTable: table,
    urgentList: buildJobFormats(urgent, ctx.stages).list,
    overdueList: buildJobFormats(overdue, ctx.stages).list,
    readyList: buildJobFormats(ready, ctx.stages).list,
  };

  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

  return {
    subject: fill(template.subject || `Update from ${vars.shop}`),
    body: fill(template.body),
  };
}

/** Build a mailto: URL for one-click email. Safe for long bodies (up to ~2000 chars). */
export function buildMailto(to: string | undefined, subject: string, body: string): string {
  const params = new URLSearchParams();
  params.set('subject', subject);
  params.set('body', body);
  const base = to ? `mailto:${encodeURIComponent(to)}` : 'mailto:';
  return `${base}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Build an sms: URL for iOS / Android. iOS uses `&body=`, Android uses `?body=`. */
export function buildSms(phone: string | undefined, body: string): string {
  const normalized = (phone || '').replace(/[^\d+]/g, '');
  return `sms:${normalized}?&body=${encodeURIComponent(body)}`;
}
