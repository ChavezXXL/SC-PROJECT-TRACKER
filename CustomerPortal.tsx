import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Package, Clock, CheckCircle, Truck, AlertTriangle, Search, FileText, Check, X, DollarSign, Copy, Link2, Phone, Mail, Calendar, MessageSquare, ChevronDown } from 'lucide-react';
import type { Job, SystemSettings, JobStage, Quote, QuoteViewEvent } from './types';
import * as DB from './services/mockDb';
import { stagesForCustomer } from './utils/stageRouting';

/** Human-friendly "3 days ago" / "2 hrs ago" — for the "last updated" hint. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Group completed jobs by year → month. Newest year first, with monthly
 *  sub-groups inside. Enables a "2026 — 47 orders" roll-up with drilldown
 *  into individual months and jobs. */
export interface MonthBucket { label: string; key: string; jobs: Job[]; }
export interface YearBucket { year: number; jobs: Job[]; months: MonthBucket[]; }

function groupByYear(jobs: Job[]): YearBucket[] {
  const byYear = new Map<number, Job[]>();
  for (const j of jobs) {
    const t = j.completedAt || j.createdAt || 0;
    if (!t) continue;
    const year = new Date(t).getFullYear();
    (byYear.get(year) || byYear.set(year, []).get(year)!).push(j);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, yjobs]) => {
      // Inside each year, group by month
      const byMonth = new Map<string, Job[]>();
      for (const j of yjobs) {
        const t = j.completedAt || j.createdAt || 0;
        const d = new Date(t);
        const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
        (byMonth.get(key) || byMonth.set(key, []).get(key)!).push(j);
      }
      const months: MonthBucket[] = [...byMonth.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([key, mjobs]) => {
          const [y, m] = key.split('-').map(Number);
          return {
            key,
            label: new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            jobs: mjobs.sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0)),
          };
        });
      return {
        year,
        jobs: yjobs.sort((a, b) => (b.completedAt || b.createdAt || 0) - (a.completedAt || a.createdAt || 0)),
        months,
      };
    });
}

interface CustomerPortalProps {
  customerFilter: string;
  quoteId?: string | null;
}

const DEFAULT_STAGES: JobStage[] = [
  { id: 'pending', label: 'Pending', color: '#71717a', order: 0 },
  { id: 'in-progress', label: 'In Progress', color: '#3b82f6', order: 1 },
  { id: 'qc', label: 'QC', color: '#f59e0b', order: 2 },
  { id: 'packing', label: 'Packing', color: '#8b5cf6', order: 3 },
  { id: 'shipped', label: 'Shipped', color: '#06b6d4', order: 4 },
  { id: 'completed', label: 'Completed', color: '#10b981', order: 5, isComplete: true },
];

function getStageIndex(job: Job, stages: JobStage[]): number {
  if (job.currentStage) {
    const idx = stages.findIndex(s => s.id === job.currentStage);
    if (idx >= 0) return idx;
  }
  const statusMap: Record<string, string> = { pending: 'pending', 'in-progress': 'in-progress', completed: 'completed', hold: 'pending' };
  const mapped = statusMap[job.status] || 'pending';
  const idx = stages.findIndex(s => s.id === mapped);
  return idx >= 0 ? idx : 0;
}

export const CustomerPortal: React.FC<CustomerPortalProps> = ({ customerFilter, quoteId }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'quote' | 'jobs'>(quoteId ? 'quote' : 'jobs');
  const [approvalDone, setApprovalDone] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeSettings(setSettings);
    const u3 = DB.subscribeQuotes(setQuotes);
    return () => { u1(); u2(); u3(); };
  }, []);

  const stages = (settings.jobStages?.length) ? [...settings.jobStages].sort((a, b) => a.order - b.order) : DEFAULT_STAGES;

  // Find the specific quote if linked
  const linkedQuote = quoteId ? quotes.find(q => q.id === quoteId) : null;

  // ─── ENGAGEMENT TRACKING (Round 2 #14) ─────────────────────────
  // Log a view event when a customer opens the quote link. Dedupes per tab via
  // a session ID stored on the window object (not persistent — new tab = new session).
  const viewLoggedRef = useRef(false);
  const viewStartRef = useRef<number>(Date.now());
  const viewSessionIdRef = useRef<string>(`sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  useEffect(() => {
    if (!linkedQuote || viewLoggedRef.current) return;
    viewLoggedRef.current = true;
    const now = Date.now();
    const sessionId = viewSessionIdRef.current;
    const newEvent: QuoteViewEvent = {
      at: now,
      sessionId,
      userAgent: navigator.userAgent.slice(0, 120),
    };
    // Append + update counters. Skip if this session already logged (defensive).
    const history = linkedQuote.viewHistory || [];
    if (history.some(h => h.sessionId === sessionId)) return;
    const updated: Quote = {
      ...linkedQuote,
      viewedAt: linkedQuote.viewedAt || now,
      lastViewedAt: now,
      viewCount: (linkedQuote.viewCount || 0) + 1,
      viewHistory: [...history, newEvent].slice(-50), // cap history at 50 entries
    };
    DB.saveQuote(updated).catch(() => {});
  }, [linkedQuote?.id]);

  // Flush a duration update when tab closes so admins can see how long a customer spent
  useEffect(() => {
    if (!linkedQuote) return;
    const handler = () => {
      try {
        const durationMs = Date.now() - viewStartRef.current;
        const sessionId = viewSessionIdRef.current;
        const history = (linkedQuote.viewHistory || []).map(h =>
          h.sessionId === sessionId ? { ...h, durationMs } : h
        );
        // Use sendBeacon-friendly synchronous path via localStorage writeLS flow
        DB.saveQuote({ ...linkedQuote, viewHistory: history }).catch(() => {});
      } catch {}
    };
    window.addEventListener('beforeunload', handler);
    return () => { handler(); window.removeEventListener('beforeunload', handler); };
  }, [linkedQuote?.id]);

  // Filter jobs for this customer — TWO STAGES:
  // Stage 1: All jobs for this customer (never changes with search) — drives "should we show search input?"
  // Stage 2: Apply the search query on top — drives the visible list
  // This split prevents the "input vanishes mid-typing" glitch that was happening when
  // searching narrowed results below the "show input" threshold, causing the input to unmount.
  const customerJobsAll = React.useMemo(() => {
    if (!customerFilter) return [];
    const cf = customerFilter.toLowerCase();
    return jobs
      .filter(j => (j.customer?.toLowerCase().includes(cf)) || j.id.toLowerCase() === cf || j.poNumber.toLowerCase() === cf)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [jobs, customerFilter]);

  const customerJobs = React.useMemo(() => {
    if (!search.trim()) return customerJobsAll;
    const s = search.trim().toLowerCase();
    return customerJobsAll.filter(j =>
      j.poNumber.toLowerCase().includes(s) ||
      j.partNumber.toLowerCase().includes(s) ||
      (j.info?.toLowerCase().includes(s) ?? false)
    );
  }, [customerJobsAll, search]);

  const customerName = linkedQuote?.billTo?.name || linkedQuote?.customer || customerJobsAll[0]?.customer || customerFilter;
  // Totals across ALL customer jobs — used for the summary at the top (shouldn't shrink when searching)
  const totalActive = customerJobsAll.filter(j => j.status !== 'completed').length;
  const totalCompleted = customerJobsAll.filter(j => j.status === 'completed').length;
  // Filtered lists — what actually renders below the search
  const activeJobs = customerJobs.filter(j => j.status !== 'completed');
  const completedJobs = customerJobs.filter(j => j.status === 'completed');

  const handleApprove = async () => {
    if (!linkedQuote) return;
    setApprovalError(null);
    try {
      await DB.saveQuote({ ...linkedQuote, status: 'accepted', acceptedAt: Date.now() });
      setApprovalDone(true);
    } catch (e) {
      console.error('Failed to approve quote:', e);
      setApprovalError('Something went wrong approving this quote. Please try again or contact us directly.');
    }
  };

  const handleDecline = async () => {
    if (!linkedQuote) return;
    setApprovalError(null);
    try {
      await DB.saveQuote({ ...linkedQuote, status: 'declined', declinedAt: Date.now() });
      setApprovalDone(true);
    } catch (e) {
      console.error('Failed to decline quote:', e);
      setApprovalError('Something went wrong submitting your response. Please try again or contact us directly.');
    }
  };

  // Current portal URL — canonical short form if a slug is defined for this customer
  const canonicalUrl = (() => {
    const base = window.location.origin + window.location.pathname;
    const slug = settings.clientSlugs?.[customerName];
    if (slug) return `${base}?c=${slug}${quoteId ? `&q=${quoteId}` : ''}`;
    return `${base}?portal=${encodeURIComponent(customerName)}${quoteId ? `&quote=${quoteId}` : ''}`;
  })();

  const [copied, setCopied] = useState(false);
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', canonicalUrl);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── Header ── */}
      <div className="bg-zinc-900 border-b border-white/5 px-4 sm:px-6 py-4 sm:py-5 sticky top-0 z-20 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {settings.companyLogo && <img src={settings.companyLogo} className="h-9 sm:h-10 object-contain shrink-0" alt="Logo" />}
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold truncate">{settings.companyName || 'SC Deburring'}</h1>
              <p className="text-xs text-zinc-500">Customer Portal</p>
            </div>
          </div>
          {/* Copy link — bookmarkable, shareable */}
          <button
            onClick={handleCopyLink}
            className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all shrink-0 ${copied ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'bg-zinc-800/80 border border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white'}`}
            title="Copy this page's link to clipboard"
          >
            {copied ? <><Check className="w-3.5 h-3.5" aria-hidden="true" /> Copied!</> : <><Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy Link</>}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* ── Customer Info ── */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
          <p className="text-zinc-500 text-xs uppercase font-bold tracking-widest">Customer</p>
          <h2 className="text-2xl font-black text-white mt-1">{customerName}</h2>
          {linkedQuote?.billTo?.contactPerson && <p className="text-sm text-zinc-400 mt-1">{linkedQuote.billTo.contactPerson}</p>}
          <div className="flex gap-4 mt-3">
            <div className="text-sm"><span className="text-zinc-500">Active Jobs:</span> <span className="text-blue-400 font-bold">{totalActive}</span></div>
            <div className="text-sm"><span className="text-zinc-500">Completed:</span> <span className="text-emerald-400 font-bold">{totalCompleted}</span></div>
          </div>
        </div>

        {/* ── Tab switcher (if quote linked) ── */}
        {linkedQuote && (
          <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5">
            <button onClick={() => setTab('quote')} className={`flex-1 px-3 py-2 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${tab === 'quote' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}><FileText className="w-4 h-4" /> Quote {linkedQuote.quoteNumber}</button>
            <button onClick={() => setTab('jobs')} className={`flex-1 px-3 py-2 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${tab === 'jobs' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}`}><Package className="w-4 h-4" /> Job Status</button>
          </div>
        )}

        {/* ══════════════════════════════════════ */}
        {/* ── QUOTE VIEW + ONLINE APPROVAL ── */}
        {/* ══════════════════════════════════════ */}
        {tab === 'quote' && linkedQuote && (
          <div className="space-y-4">
            {/* Quote Status Banner */}
            {approvalDone || linkedQuote.status === 'accepted' ? (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center">
                <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
                <p className="text-emerald-400 font-bold text-lg">Quote Approved!</p>
                <p className="text-zinc-400 text-sm mt-1">Thank you. We'll get started on your order.</p>
              </div>
            ) : linkedQuote.status === 'declined' ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
                <X className="w-12 h-12 text-red-400 mx-auto mb-2" />
                <p className="text-red-400 font-bold text-lg">Quote Declined</p>
                <p className="text-zinc-400 text-sm mt-1">Contact us if you'd like to discuss revisions.</p>
              </div>
            ) : (() => {
                // Expiration countdown — urgency badge driven by days remaining
                const validDate = linkedQuote.validUntil
                  ? (() => {
                      const raw = linkedQuote.validUntil;
                      // Accept both MM/DD/YYYY and YYYY-MM-DD
                      const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                      if (us) return new Date(+us[3], +us[1] - 1, +us[2], 23, 59, 59);
                      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
                      if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], 23, 59, 59);
                      const d = new Date(raw);
                      return isNaN(d.getTime()) ? null : d;
                    })()
                  : null;
                const msLeft = validDate ? validDate.getTime() - Date.now() : null;
                const daysLeft = msLeft !== null ? Math.ceil(msLeft / 86400000) : null;
                const isExpired = daysLeft !== null && daysLeft < 0;
                const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;

                if (isExpired) {
                  return (
                    <div className="bg-zinc-800/40 border border-zinc-600/30 rounded-2xl p-6 text-center">
                      <Clock className="w-12 h-12 text-zinc-500 mx-auto mb-2" aria-hidden="true" />
                      <p className="text-zinc-400 font-bold text-lg">Quote Expired</p>
                      <p className="text-zinc-500 text-sm mt-1">This quote has passed its validity date. Please contact us for an updated quote.</p>
                    </div>
                  );
                }
                return (
                  <div className={`bg-gradient-to-br ${isUrgent ? 'from-orange-500/15 to-red-500/5 border-orange-500/30' : 'from-blue-500/10 to-indigo-500/5 border-blue-500/20'} border rounded-2xl p-5`}>
                    {isUrgent && daysLeft !== null && (
                      <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-orange-500/15 border border-orange-500/30 rounded-lg">
                        <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 animate-pulse" aria-hidden="true" />
                        <p className="text-xs font-black text-orange-400 uppercase tracking-widest">
                          {daysLeft === 0 ? 'Expires today!' : daysLeft === 1 ? 'Expires tomorrow!' : `Expires in ${daysLeft} days`}
                        </p>
                      </div>
                    )}
                    {!isUrgent && daysLeft !== null && daysLeft <= 30 && (
                      <p className="text-[11px] font-bold text-blue-400 mb-3 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Valid for {daysLeft} more days
                      </p>
                    )}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <p className="text-blue-400 font-bold">Quote Ready for Review</p>
                        <p className="text-zinc-400 text-xs mt-0.5">Review the details below, then approve or decline.</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleApprove} className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/20"><Check className="w-4 h-4" /> Approve Quote</button>
                        <button onClick={handleDecline} className="bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2"><X className="w-4 h-4" /> Decline</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* Quote Details Card */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-white/5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white font-bold text-lg">{linkedQuote.quoteNumber}</p>
                    {(linkedQuote.revisions?.length || 0) > 0 && (
                      <span className="text-[9px] font-black text-purple-400 bg-purple-500/10 border border-purple-500/25 px-1.5 py-0.5 rounded uppercase tracking-widest" title={`This quote has been revised ${linkedQuote.revisions!.length} time(s) since it was first sent.`}>
                        Version {linkedQuote.revisions!.length + 1} (updated)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">Created {new Date(linkedQuote.createdAt).toLocaleDateString()}{linkedQuote.validUntil ? ` · Valid until ${linkedQuote.validUntil}` : ''}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold border ${linkedQuote.status === 'accepted' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : linkedQuote.status === 'declined' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                  {linkedQuote.status.toUpperCase()}
                </div>
              </div>

              {/* Scope of Work */}
              {linkedQuote.jobDescription && (
                <div className="px-5 py-4 border-b border-white/5 bg-blue-500/5">
                  <p className="text-[10px] text-blue-400 uppercase font-bold tracking-widest mb-1">Scope of Work</p>
                  <p className="text-sm text-zinc-300">{linkedQuote.jobDescription}</p>
                </div>
              )}

              {/* Line Items */}
              <div className="px-5 py-4">
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-3">Items</p>
                <div className="space-y-2">
                  {linkedQuote.items.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0">
                      <div>
                        <p className="text-white text-sm font-medium">{item.description}</p>
                        <p className="text-xs text-zinc-500">{item.qty} {item.unit || 'ea'} × ${item.unitPrice.toFixed(2)}</p>
                      </div>
                      <p className="text-white font-bold font-mono">${item.total.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="px-5 py-4 bg-zinc-800/30 space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-zinc-500">Subtotal</span><span className="text-zinc-300 font-mono">${linkedQuote.subtotal.toFixed(2)}</span></div>
                {linkedQuote.markupPct > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Markup ({linkedQuote.markupPct}%)</span><span className="text-zinc-300 font-mono">+${(linkedQuote.subtotal * linkedQuote.markupPct / 100).toFixed(2)}</span></div>}
                {(linkedQuote.discountAmt || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Discount ({linkedQuote.discountPct}%)</span><span className="text-red-400 font-mono">-${linkedQuote.discountAmt?.toFixed(2)}</span></div>}
                {(linkedQuote.taxAmt || 0) > 0 && <div className="flex justify-between text-sm"><span className="text-zinc-500">Tax ({linkedQuote.taxRate}%)</span><span className="text-zinc-300 font-mono">+${linkedQuote.taxAmt?.toFixed(2)}</span></div>}
                <div className="flex justify-between text-xl font-bold border-t border-white/10 pt-3 mt-2"><span className="text-white">Total</span><span className="text-emerald-400 font-mono">${linkedQuote.total.toFixed(2)}</span></div>
                {linkedQuote.depositRequired && linkedQuote.depositAmt && (
                  <div className="flex justify-between text-sm text-cyan-400 font-medium pt-1"><span>Deposit Due ({linkedQuote.depositPct}%)</span><span className="font-mono">${linkedQuote.depositAmt.toFixed(2)}</span></div>
                )}
              </div>

              {/* Notes & Terms */}
              {(linkedQuote.notes || linkedQuote.terms) && (
                <div className="px-5 py-4 border-t border-white/5 space-y-3">
                  {linkedQuote.notes && <div><p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Notes</p><p className="text-sm text-zinc-400">{linkedQuote.notes}</p></div>}
                  {linkedQuote.terms && <div><p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Terms & Conditions</p><p className="text-sm text-zinc-400">{linkedQuote.terms}</p></div>}
                </div>
              )}
            </div>

            {/* Inline error — replaces the old window.alert(). Customer-facing
                so the wording is friendly + actionable, not a stack trace. */}
            {approvalError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm flex-1">{approvalError}</p>
                <button type="button" onClick={() => setApprovalError(null)} aria-label="Dismiss" className="text-red-300 hover:text-white p-0.5">
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Approve/Decline Buttons (bottom) */}
            {linkedQuote.status === 'sent' && !approvalDone && (
              <div className="flex gap-3 justify-center pt-2">
                <button onClick={handleApprove} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-500/20"><Check className="w-5 h-5" /> Approve & Start Work</button>
                <button onClick={handleDecline} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-6 py-3 rounded-xl font-bold text-sm"><X className="w-4 h-4 inline mr-1" /> Decline</button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════ */}
        {/* ── JOB STATUS VIEW ── */}
        {/* ══════════════════════════════════════ */}
        {tab === 'jobs' && (
          <>
            {/* Search — show whenever there's more than 3 TOTAL jobs, regardless of current filter.
                Using customerJobsAll (not customerJobs) so the input doesn't unmount mid-typing. */}
            {customerJobsAll.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" aria-hidden="true" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by PO, part number, or notes…"
                  className="w-full bg-zinc-900/50 border border-white/5 rounded-xl py-3 pl-10 pr-10 text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
                  aria-label="Search jobs"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-1 rounded transition-colors"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {/* Search result summary when filtering */}
            {search.trim() && customerJobsAll.length > 0 && (
              <p className="text-xs text-zinc-500 -mt-3">
                {customerJobs.length === 0
                  ? <>No matches for <strong className="text-zinc-300">"{search}"</strong> · <button onClick={() => setSearch('')} className="text-blue-400 hover:text-blue-300 font-semibold">clear search</button></>
                  : <>Showing <strong className="text-zinc-300">{customerJobs.length}</strong> of {customerJobsAll.length} job{customerJobsAll.length !== 1 ? 's' : ''}</>}
              </p>
            )}

            {customerJobsAll.length === 0 && (
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-12 text-center">
                <Package className="w-12 h-12 text-zinc-600 mx-auto mb-3" aria-hidden="true" />
                <p className="text-zinc-400 font-bold">No jobs yet</p>
                <p className="text-zinc-600 text-sm mt-1">No active orders on file. Check back later or contact us to place a new order.</p>
              </div>
            )}

            {/* Active Jobs */}
            {activeJobs.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Active Orders · {activeJobs.length}</h3>
                <div className="space-y-3">
                  {activeJobs.map(job => {
                    // Stages filtered to THIS customer's workflow (skips Stamp
                    // if the customer profile excludes it, etc.)
                    const custStages = stagesForCustomer(
                      stages,
                      settings.clientContacts?.[job.customer || ''],
                    );
                    const stageIdx = getStageIndex(job, custStages);
                    const isOverdue = job.dueDate && new Date(job.dueDate).getTime() < Date.now();
                    const portalNote = job.portalNote;
                    return (
                      <div key={job.id} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-3 sm:p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-black text-base sm:text-lg truncate max-w-[180px] sm:max-w-none">{job.poNumber}</span>
                              {isOverdue && <span className="text-[10px] font-black text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> OVERDUE</span>}
                              {portalNote?.expectedDate && !isOverdue && (
                                <span className="text-[10px] font-black text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" /> Expected {portalNote.expectedDate}
                                </span>
                              )}
                            </div>
                            <p className="text-xs sm:text-sm text-zinc-400 truncate">{job.partNumber}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs sm:text-sm text-zinc-500">Qty: <span className="text-white font-bold">{job.quantity}</span></p>
                            {job.dueDate && <p className="text-[10px] sm:text-xs text-zinc-500">Due: <span className={isOverdue ? 'text-red-400' : 'text-zinc-300'}>{job.dueDate}</span></p>}
                          </div>
                        </div>

                        {/* Portal note — the human-friendly status message.
                            Big, blue, and glowing so it's impossible to miss.
                            Fresh notes (<24h) pulse a subtle "new" halo. */}
                        {portalNote?.text && (() => {
                          const isFresh = Date.now() - portalNote.updatedAt < 86_400_000;
                          return (
                            <div
                              className={`relative rounded-xl p-4 flex items-start gap-3 bg-gradient-to-br from-blue-500/15 to-blue-500/5 border-2 ${
                                isFresh ? 'border-blue-400/60 shadow-lg shadow-blue-500/20' : 'border-blue-500/30'
                              }`}
                            >
                              {isFresh && (
                                <span className="absolute -top-2 left-4 bg-blue-500 text-white text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded shadow-md">
                                  ● New Update
                                </span>
                              )}
                              <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                                <MessageSquare className="w-4 h-4 text-blue-300" aria-hidden="true" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-1">Latest Update</p>
                                <p className="text-sm text-white font-medium leading-relaxed whitespace-pre-line">{portalNote.text}</p>
                                <p className="text-[10px] text-blue-400/80 mt-2">Posted {relativeTime(portalNote.updatedAt)}</p>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Stage Pipeline — uses customer-specific stages */}
                        <div className="flex items-center gap-1">
                          {custStages.map((stage, i) => (
                            <div key={stage.id} className="flex-1 flex flex-col items-center gap-1">
                              <div className={`h-2 w-full rounded-full transition-all ${i <= stageIdx ? '' : 'opacity-20'}`} style={{ background: i <= stageIdx ? stage.color : '#3f3f46' }} />
                              <span className={`text-[9px] font-bold ${i <= stageIdx ? 'text-zinc-300' : 'text-zinc-600'}`}>{stage.label}</span>
                            </div>
                          ))}
                        </div>
                        {job.trackingNumber && (
                          <div className="flex items-center gap-2 text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-3 py-2">
                            <Truck className="w-3.5 h-3.5" /> Tracking: {job.trackingNumber} {job.shippingMethod && <span className="text-zinc-500">({job.shippingMethod})</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Completed Jobs — grouped by month, collapsible, with totals.
                Shows the most recent 2 months expanded; everything older
                collapsed by default so the page doesn't scroll forever. */}
            {completedJobs.length > 0 && (
              <CompletedJobsSection jobs={completedJobs} />
            )}
          </>
        )}

        {/* ── Contact / Questions CTA ── */}
        {(settings.companyPhone || settings.companyAddress) && (
          <div className="bg-zinc-900/40 border border-white/5 rounded-2xl p-5 text-center">
            <p className="text-sm font-bold text-white mb-1">Questions about your order?</p>
            <p className="text-xs text-zinc-500 mb-3">We're here to help.</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {settings.companyPhone && (
                <a href={`tel:${settings.companyPhone}`} className="flex items-center gap-2 text-sm font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 px-4 py-2 rounded-xl transition-all">
                  <Phone className="w-4 h-4" aria-hidden="true" /> {settings.companyPhone}
                </a>
              )}
              {settings.companyAddress && (
                <span className="text-xs text-zinc-500 px-3 py-2">{settings.companyAddress}</span>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="text-center pt-4 pb-4">
          <p className="text-zinc-600 text-xs">Powered by <span className="text-zinc-500 font-bold">{settings.companyName || 'SC Tracker'}</span></p>
          <p className="text-zinc-700 text-[10px] mt-1 font-mono truncate max-w-md mx-auto px-2">{canonicalUrl}</p>
        </div>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Completed jobs — two-level hierarchy (Year → Month → Jobs).
//
// Top: a big "This Year" summary card so customers see their running
// total at a glance.
// Below: each year is a collapsible card with inner monthly sub-groups.
// Current year expanded by default; everything older collapsed.
// ═════════════════════════════════════════════════════════════════════
const CompletedJobsSection: React.FC<{ jobs: Job[] }> = ({ jobs }) => {
  const years = useMemo(() => groupByYear(jobs), [jobs]);
  const currentYear = new Date().getFullYear();
  const [openYears, setOpenYears] = useState<Set<number>>(() => new Set([currentYear]));
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set());

  const toggleYear = (y: number) => {
    setOpenYears(prev => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  };
  const toggleMonth = (k: string) => {
    setOpenMonths(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // "This year" stats — prominent so customers can brag about it
  const thisYearBucket = years.find(y => y.year === currentYear);
  const thisYearQty = thisYearBucket?.jobs.reduce((a, j) => a + (j.quantity || 0), 0) || 0;
  const thisYearCount = thisYearBucket?.jobs.length || 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Completed Orders · {jobs.length} total</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpenYears(new Set(years.map(y => y.year)))}
            className="text-[10px] font-bold text-zinc-500 hover:text-white bg-zinc-900/40 hover:bg-white/5 border border-white/5 rounded px-2 py-1 transition-colors"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => { setOpenYears(new Set()); setOpenMonths(new Set()); }}
            className="text-[10px] font-bold text-zinc-500 hover:text-white bg-zinc-900/40 hover:bg-white/5 border border-white/5 rounded px-2 py-1 transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* "This year" hero card — simple, big, clear */}
      {thisYearCount > 0 && (
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/25 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <CheckCircle className="w-6 h-6 text-emerald-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">This Year · {currentYear}</p>
            <p className="text-white text-lg font-black tabular">
              {thisYearCount} order{thisYearCount !== 1 ? 's' : ''}
              <span className="text-zinc-500 font-normal mx-2">·</span>
              {thisYearQty.toLocaleString()} piece{thisYearQty !== 1 ? 's' : ''} completed
            </p>
          </div>
        </div>
      )}

      {/* Year → Month → Jobs tree */}
      <div className="space-y-2">
        {years.map(y => {
          const open = openYears.has(y.year);
          const totalQty = y.jobs.reduce((a, j) => a + (j.quantity || 0), 0);
          return (
            <div key={y.year} className="bg-zinc-900/30 border border-white/5 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => toggleYear(y.year)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                aria-expanded={open}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0">
                    <span className="text-[11px] font-black text-zinc-300 tabular">{String(y.year).slice(-2)}</span>
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-base font-black text-white tabular">{y.year}</p>
                    <p className="text-[11px] text-zinc-500">
                      {y.jobs.length} order{y.jobs.length !== 1 ? 's' : ''} · {totalQty.toLocaleString()} piece{totalQty !== 1 ? 's' : ''}
                      {y.months.length > 1 && ` · ${y.months.length} months`}
                    </p>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {open && (
                <div className="border-t border-white/5 divide-y divide-white/5">
                  {y.months.map(m => {
                    const mOpen = openMonths.has(m.key);
                    const mQty = m.jobs.reduce((a, j) => a + (j.quantity || 0), 0);
                    return (
                      <div key={m.key}>
                        <button
                          type="button"
                          onClick={() => toggleMonth(m.key)}
                          className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/[0.02] transition-colors"
                          aria-expanded={mOpen}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500/70 shrink-0" aria-hidden="true" />
                            <div className="text-left min-w-0">
                              <p className="text-sm font-bold text-zinc-200">{m.label.replace(` ${y.year}`, '')}</p>
                              <p className="text-[10px] text-zinc-500">{m.jobs.length} order{m.jobs.length !== 1 ? 's' : ''} · {mQty.toLocaleString()} pcs</p>
                            </div>
                          </div>
                          <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 shrink-0 transition-transform ${mOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                        </button>
                        {mOpen && (
                          <div className="bg-zinc-950/40 border-t border-white/5 divide-y divide-white/5">
                            {m.jobs.map(job => (
                              <div key={job.id} className="px-6 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-white truncate">{job.poNumber}</p>
                                  <p className="text-[11px] text-zinc-500 truncate">{job.partNumber}</p>
                                </div>
                                <div className="text-right shrink-0 flex items-center gap-3">
                                  <span className="text-[11px] text-zinc-400 font-mono tabular">{(job.quantity || 0).toLocaleString()} ea</span>
                                  {job.completedAt && (
                                    <span className="text-[10px] text-zinc-600 font-mono tabular w-20 text-right">{new Date(job.completedAt).toLocaleDateString()}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
