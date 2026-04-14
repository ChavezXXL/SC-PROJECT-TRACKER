import React, { useState, useEffect } from 'react';
import { Package, Clock, CheckCircle, Truck, AlertTriangle, Search, FileText, Check, X, DollarSign } from 'lucide-react';
import type { Job, SystemSettings, JobStage, Quote } from './types';
import * as DB from './services/mockDb';

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

  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeSettings(setSettings);
    const u3 = DB.subscribeQuotes(setQuotes);
    return () => { u1(); u2(); u3(); };
  }, []);

  const stages = (settings.jobStages?.length) ? [...settings.jobStages].sort((a, b) => a.order - b.order) : DEFAULT_STAGES;

  // Find the specific quote if linked
  const linkedQuote = quoteId ? quotes.find(q => q.id === quoteId) : null;

  // Filter jobs for this customer
  const customerJobs = jobs.filter(j => {
    if (!customerFilter) return false;
    const cf = customerFilter.toLowerCase();
    return (j.customer?.toLowerCase().includes(cf)) || j.id.toLowerCase() === cf || j.poNumber.toLowerCase() === cf;
  }).filter(j => {
    if (!search) return true;
    const s = search.toLowerCase();
    return j.poNumber.toLowerCase().includes(s) || j.partNumber.toLowerCase().includes(s);
  }).sort((a, b) => b.createdAt - a.createdAt);

  const customerName = linkedQuote?.billTo?.name || linkedQuote?.customer || customerJobs[0]?.customer || customerFilter;
  const activeJobs = customerJobs.filter(j => j.status !== 'completed');
  const completedJobs = customerJobs.filter(j => j.status === 'completed');

  const handleApprove = async () => {
    if (!linkedQuote) return;
    try {
      await DB.saveQuote({ ...linkedQuote, status: 'accepted', acceptedAt: Date.now() });
      setApprovalDone(true);
    } catch {}
  };

  const handleDecline = async () => {
    if (!linkedQuote) return;
    try {
      await DB.saveQuote({ ...linkedQuote, status: 'declined', declinedAt: Date.now() });
      setApprovalDone(true);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── Header ── */}
      <div className="bg-zinc-900 border-b border-white/5 px-6 py-5">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{settings.companyName || 'SC Deburring'}</h1>
            <p className="text-sm text-zinc-500">Customer Portal</p>
          </div>
          {settings.companyLogo && <img src={settings.companyLogo} className="h-10 object-contain" alt="Logo" />}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* ── Customer Info ── */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
          <p className="text-zinc-500 text-xs uppercase font-bold tracking-widest">Customer</p>
          <h2 className="text-2xl font-black text-white mt-1">{customerName}</h2>
          {linkedQuote?.billTo?.contactPerson && <p className="text-sm text-zinc-400 mt-1">{linkedQuote.billTo.contactPerson}</p>}
          <div className="flex gap-4 mt-3">
            <div className="text-sm"><span className="text-zinc-500">Active Jobs:</span> <span className="text-blue-400 font-bold">{activeJobs.length}</span></div>
            <div className="text-sm"><span className="text-zinc-500">Completed:</span> <span className="text-emerald-400 font-bold">{completedJobs.length}</span></div>
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
            ) : (
              /* Active quote — show approve/decline buttons */
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
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
            )}

            {/* Quote Details Card */}
            <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
              <div className="p-5 border-b border-white/5 flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">{linkedQuote.quoteNumber}</p>
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
            {/* Search */}
            {customerJobs.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by PO or part number..." className="w-full bg-zinc-900/50 border border-white/5 rounded-xl py-3 pl-10 pr-4 text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/50" />
              </div>
            )}

            {customerJobs.length === 0 && (
              <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-12 text-center">
                <Package className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400 font-bold">No jobs found</p>
                <p className="text-zinc-600 text-sm mt-1">No active jobs for this customer.</p>
              </div>
            )}

            {/* Active Jobs */}
            {activeJobs.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Active Orders</h3>
                <div className="space-y-3">
                  {activeJobs.map(job => {
                    const stageIdx = getStageIndex(job, stages);
                    const isOverdue = job.dueDate && new Date(job.dueDate).getTime() < Date.now();
                    return (
                      <div key={job.id} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-black text-lg">{job.poNumber}</span>
                              {isOverdue && <span className="text-[10px] font-black text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> OVERDUE</span>}
                            </div>
                            <p className="text-sm text-zinc-400">{job.partNumber}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm text-zinc-500">Qty: <span className="text-white font-bold">{job.quantity}</span></p>
                            {job.dueDate && <p className="text-xs text-zinc-500">Due: <span className={isOverdue ? 'text-red-400' : 'text-zinc-300'}>{job.dueDate}</span></p>}
                          </div>
                        </div>
                        {/* Stage Pipeline */}
                        <div className="flex items-center gap-1">
                          {stages.map((stage, i) => (
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

            {/* Completed Jobs */}
            {completedJobs.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Completed Orders</h3>
                <div className="space-y-2">
                  {completedJobs.slice(0, 10).map(job => (
                    <div key={job.id} className="bg-zinc-900/30 border border-white/5 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
                        <div>
                          <span className="text-white font-bold text-sm">{job.poNumber}</span>
                          <span className="text-zinc-500 text-sm ml-2">{job.partNumber}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-zinc-500">Qty: {job.quantity}</p>
                        {job.completedAt && <p className="text-[10px] text-zinc-600">{new Date(job.completedAt).toLocaleDateString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Footer ── */}
        <div className="text-center pt-8 pb-4">
          <p className="text-zinc-600 text-xs">Powered by <span className="text-zinc-500 font-bold">SC Tracker</span></p>
          {settings.companyPhone && <p className="text-zinc-600 text-xs mt-1">Questions? Call {settings.companyPhone}</p>}
        </div>
      </div>
    </div>
  );
};
