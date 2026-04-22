// ═════════════════════════════════════════════════════════════════════
// Client Update Generator — modal for producing a ready-to-send message
// summarizing a chosen customer's jobs.
//
// Flow:
//   1. Admin opens the modal (optionally pre-filtered by customer).
//   2. Picks which jobs to include (all open jobs for that customer
//      are pre-selected; can check/uncheck).
//   3. Picks a template (Status Update, Delay Notice, etc.).
//   4. Sees the preview update live as they tweak selections.
//   5. Acts: Copy · Email (mailto:) · SMS (sms:).
//
// No external services — the mail/sms links open the user's default
// app, so nothing leaves the browser until they hit Send themselves.
// ═════════════════════════════════════════════════════════════════════

import React, { useMemo, useState, useEffect } from 'react';
import { X, Copy, Mail, MessageSquare, Check, FileText } from 'lucide-react';
import type { Job, JobStage, SystemSettings, CustomerContact } from '../types';
import { BUILT_IN_TEMPLATES, renderClientUpdate, buildMailto, buildSms, type ClientUpdateTemplate } from '../utils/clientUpdate';

interface Props {
  jobs: Job[];              // all jobs in the shop — we filter by customer
  stages: JobStage[];
  settings: SystemSettings;
  userName: string;
  /** When provided, the modal opens pre-filtered to this customer. */
  initialCustomer?: string;
  /** Set of pre-selected job IDs. When provided, those jobs are auto-checked. */
  initialJobIds?: string[];
  onClose: () => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const ClientUpdateGenerator: React.FC<Props> = ({
  jobs, stages, settings, userName, initialCustomer, initialJobIds, onClose, onToast,
}) => {
  // Unique customers (only those with at least one job — we don't care
  // about the full contact book for this flow).
  const customers = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach(j => { if (j.customer) set.add(j.customer); });
    return [...set].sort();
  }, [jobs]);

  const [customer, setCustomer] = useState<string>(initialCustomer || customers[0] || '');
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(() => new Set(initialJobIds || []));
  const [templateId, setTemplateId] = useState<string>(BUILT_IN_TEMPLATES[0].id);
  const [editingBody, setEditingBody] = useState(false);
  const [customBody, setCustomBody] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Customer's jobs — memoized so a big job list doesn't re-filter per render
  const customerJobs = useMemo(
    () => jobs.filter(j => j.customer === customer),
    [jobs, customer],
  );

  // Pre-select all OPEN jobs for the customer on first mount / customer change —
  // admins almost always want to update on what's active, not historical.
  useEffect(() => {
    if (initialJobIds && initialJobIds.length > 0) return; // caller set the selection
    const open = customerJobs.filter(j => j.status !== 'completed').map(j => j.id);
    setSelectedJobIds(new Set(open));
  }, [customer, customerJobs, initialJobIds]);

  const selectedJobs = useMemo(
    () => customerJobs.filter(j => selectedJobIds.has(j.id)),
    [customerJobs, selectedJobIds],
  );

  const template = BUILT_IN_TEMPLATES.find(t => t.id === templateId) || BUILT_IN_TEMPLATES[0];

  // Customer contact from settings — used for mailto: / sms: defaults
  const contact: CustomerContact | undefined = settings.clientContacts?.[customer];

  const rendered = useMemo(() => {
    return renderClientUpdate(template, {
      customer,
      contact: contact?.contactPerson,
      jobs: selectedJobs,
      settings,
      stages,
      userName,
    });
  }, [template, customer, contact, selectedJobs, settings, stages, userName]);

  // Effective body — admin may have edited it inline
  const finalBody = customBody ?? rendered.body;
  const finalSubject = rendered.subject;

  const toggleJob = (jobId: string) => {
    const next = new Set(selectedJobIds);
    if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
    setSelectedJobIds(next);
  };

  const selectAll = () => setSelectedJobIds(new Set(customerJobs.map(j => j.id)));
  const selectOpen = () => setSelectedJobIds(new Set(customerJobs.filter(j => j.status !== 'completed').map(j => j.id)));
  const selectNone = () => setSelectedJobIds(new Set());

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(finalBody);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onToast?.('success', 'Copied to clipboard');
    } catch {
      onToast?.('error', 'Could not copy — select and copy manually');
    }
  };

  const openEmail = () => {
    const url = buildMailto(contact?.email, finalSubject, finalBody);
    window.location.href = url;
  };

  const openSms = () => {
    if (!contact?.phone) {
      onToast?.('error', 'No phone number on file for this customer');
      return;
    }
    window.location.href = buildSms(contact.phone, finalBody);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/95 backdrop-blur-sm p-0 sm:p-4 animate-fade-in" onClick={onClose}>
      <div
        className="w-full sm:max-w-4xl bg-zinc-900 border border-white/10 rounded-none sm:rounded-2xl shadow-2xl flex flex-col max-h-[100dvh] sm:max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-400" aria-hidden="true" />
              Client Update Generator
            </h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">Pick jobs, pick a template — get a message ready to send.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body — 2-column on desktop, stacked on mobile */}
        <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_1fr]">
          {/* Left — controls */}
          <div className="overflow-y-auto border-r border-white/5 p-4 space-y-4">
            {/* Customer picker */}
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Customer</label>
              <select
                value={customer}
                onChange={e => setCustomer(e.target.value)}
                className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2 py-2 text-sm text-white"
              >
                {customers.length === 0 && <option value="">No customers yet</option>}
                {customers.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {contact && (
                <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-zinc-500">
                  {contact.contactPerson && <span>👤 {contact.contactPerson}</span>}
                  {contact.email && <span>✉ {contact.email}</span>}
                  {contact.phone && <span>☎ {contact.phone}</span>}
                </div>
              )}
            </div>

            {/* Template picker */}
            <div>
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Template</label>
              <div className="space-y-1">
                {BUILT_IN_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTemplateId(t.id); setCustomBody(null); setEditingBody(false); }}
                    aria-pressed={templateId === t.id}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${templateId === t.id ? 'bg-blue-500/15 border-blue-500/40 text-white' : 'bg-zinc-950 border-white/5 text-zinc-400 hover:text-white hover:border-white/15'}`}
                  >
                    <p className="text-xs font-black">{t.label}</p>
                    {t.filter && t.filter !== 'all' && (
                      <p className="text-[10px] text-zinc-600 mt-0.5">Auto-filters to {t.filter} jobs</p>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Job selection */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                  Jobs ({selectedJobs.length}/{customerJobs.length})
                </label>
                <div className="flex items-center gap-1 text-[10px]">
                  <button type="button" onClick={selectOpen} className="text-blue-400 hover:text-white font-bold">Open</button>
                  <span className="text-zinc-700">·</span>
                  <button type="button" onClick={selectAll} className="text-blue-400 hover:text-white font-bold">All</button>
                  <span className="text-zinc-700">·</span>
                  <button type="button" onClick={selectNone} className="text-zinc-500 hover:text-white font-bold">None</button>
                </div>
              </div>
              <div className="bg-zinc-950 border border-white/5 rounded-lg max-h-64 overflow-y-auto">
                {customerJobs.length === 0 ? (
                  <p className="text-[11px] italic text-zinc-600 py-4 text-center">No jobs for this customer.</p>
                ) : customerJobs.map(job => {
                  const picked = selectedJobIds.has(job.id);
                  const isComplete = job.status === 'completed';
                  return (
                    <label
                      key={job.id}
                      className={`flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.03] border-b border-white/5 last:border-b-0 ${picked ? 'bg-blue-500/5' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => toggleJob(job.id)}
                        className="mt-0.5 accent-blue-500 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-white tabular truncate">{job.poNumber}</span>
                          {job.priority === 'urgent' && <span className="text-[9px] font-black text-red-400 bg-red-500/15 border border-red-500/25 rounded px-1">URG</span>}
                          {isComplete && <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 rounded px-1">DONE</span>}
                        </div>
                        <p className="text-[10px] text-zinc-400 truncate">{job.partNumber}{job.quantity ? ` × ${job.quantity}` : ''}</p>
                        {job.dueDate && <p className="text-[10px] text-zinc-600">Due {job.dueDate}</p>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right — preview */}
          <div className="overflow-y-auto p-4 space-y-3 bg-zinc-950/40">
            {finalSubject && (
              <div>
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Subject</label>
                <input
                  type="text"
                  value={finalSubject}
                  readOnly
                  className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Message</label>
                <button
                  type="button"
                  onClick={() => {
                    if (editingBody) {
                      setEditingBody(false);
                    } else {
                      setEditingBody(true);
                      if (customBody === null) setCustomBody(rendered.body);
                    }
                  }}
                  className="text-[10px] font-black text-blue-400 hover:text-white"
                >
                  {editingBody ? 'Done editing' : 'Edit before sending'}
                </button>
              </div>
              {editingBody ? (
                <textarea
                  value={finalBody}
                  onChange={e => setCustomBody(e.target.value)}
                  rows={20}
                  className="w-full bg-zinc-950 border border-blue-500/40 rounded-lg px-3 py-2 text-sm text-white font-mono leading-relaxed"
                />
              ) : (
                <pre className="bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono leading-relaxed whitespace-pre-wrap break-words min-h-[300px] max-h-[60vh] overflow-y-auto">
                  {finalBody}
                </pre>
              )}
              {customBody !== null && !editingBody && (
                <button
                  type="button"
                  onClick={() => { setCustomBody(null); }}
                  className="text-[10px] text-zinc-500 hover:text-white mt-1"
                >
                  ↺ Reset to template
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer — actions */}
        <div className="shrink-0 px-4 py-3 border-t border-white/10 flex items-center gap-2 flex-wrap bg-zinc-950/60">
          <button
            type="button"
            onClick={copyToClipboard}
            className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={openEmail}
            disabled={!contact?.email && customers.length > 0}
            title={contact?.email ? `Email to ${contact.email}` : 'No email on file — will open blank compose'}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Mail className="w-3.5 h-3.5" aria-hidden="true" />
            Email{contact?.email ? '' : ' (blank)'}
          </button>
          <button
            type="button"
            onClick={openSms}
            disabled={!contact?.phone}
            title={contact?.phone ? `Text to ${contact.phone}` : 'No phone on file'}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
            Text
          </button>
          <div className="ml-auto text-[10px] text-zinc-500">
            {selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''} · {finalBody.length} char{finalBody.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  );
};
