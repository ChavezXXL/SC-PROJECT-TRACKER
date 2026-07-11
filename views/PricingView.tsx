/**
 * PricingView — the Price Doctor.
 * "Which jobs deserve more capacity and which need price increases."
 * For every part with learned cycle data: true burdened cost per piece,
 * what's actually being charged, the margin that implies, and the price
 * that hits the target margin — sorted by money left on the table.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Stethoscope, Search, Download, TrendingDown, AlertTriangle, CheckCircle,
  HelpCircle, ChevronDown, ChevronUp,
} from 'lucide-react';

import { Job, TimeLog, SystemSettings } from '../types';
import * as DB from '../services/mockDb';
import { computePriceDoctor } from '../utils/priceDoctor';
import type { PartPricing, PriceVerdict } from '../utils/priceDoctor';

const money = (n: number, cents = true): string =>
  `$${cents ? n.toFixed(2) : Math.round(n).toLocaleString()}`;

const VERDICT_META: Record<PriceVerdict, { label: string; cls: string; icon: React.ReactNode }> = {
  underpriced: { label: 'Underpriced', cls: 'text-red-300 bg-red-500/10 border-red-500/25', icon: <TrendingDown className="w-3 h-3" /> },
  'no-price':  { label: 'No price set', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25', icon: <HelpCircle className="w-3 h-3" /> },
  thin:        { label: 'Thin margin', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/25', icon: <AlertTriangle className="w-3 h-3" /> },
  healthy:     { label: 'Healthy', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25', icon: <CheckCircle className="w-3 h-3" /> },
};

function downloadCsv(filename: string, rows: (string | number | undefined | null)[][]) {
  const esc = (v: string | number | undefined | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const PricingView = ({ addToast }: any) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(DB.getSettings());
  const [search, setSearch] = useState('');
  const [targetMargin, setTargetMargin] = useState(35);
  const [verdictFilter, setVerdictFilter] = useState<'' | PriceVerdict>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const u1 = DB.subscribeJobs(setJobs);
    const u2 = DB.subscribeLogs(setLogs);
    const u3 = DB.subscribeSettings(setSettings);
    return () => { u1(); u2(); u3(); };
  }, []);

  const doctor = useMemo(
    () => computePriceDoctor(jobs, logs, settings, Date.now(), targetMargin),
    [jobs, logs, settings, targetMargin],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return doctor.parts.filter(p => {
      if (verdictFilter && p.verdict !== verdictFilter) return false;
      if (q && ![p.partNumber, p.customer].filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [doctor.parts, search, verdictFilter]);

  const counts = useMemo(() => {
    const c: Record<PriceVerdict, number> = { underpriced: 0, 'no-price': 0, thin: 0, healthy: 0 };
    doctor.parts.forEach(p => c[p.verdict]++);
    return c;
  }, [doctor.parts]);

  const exportCsv = () => {
    if (filtered.length === 0) { addToast('info', 'Nothing to export'); return; }
    downloadCsv(`price-doctor-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Part', 'Customer', 'Runs', '90d pieces', 'Labor min/pc', 'Cost/pc', 'Current $/pc', 'Margin now %', `Recommended $/pc (@${doctor.targetMarginPct}%)`, 'Money left (90d vol)', 'Verdict', 'Confidence'],
      ...filtered.map(p => [
        p.partNumber, p.customer, p.runs, p.volume90d,
        p.laborMinPerPiece.toFixed(2), p.costPerPiece.toFixed(2),
        p.currentPricePerPiece?.toFixed(2), p.marginNowPct === null ? '' : Math.round(p.marginNowPct),
        p.recommendedPrice.toFixed(2), Math.round(p.moneyLeft90d), p.verdict, p.confidence,
      ]),
    ]);
  };

  if (doctor.burdenedRate <= 0) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><Stethoscope className="w-6 h-6 text-amber-500" /> Price Doctor</h2>
        <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
          <p className="font-medium">Set your Shop Rate first (Settings → Financial).</p>
          <p className="text-sm mt-1 text-zinc-600">The doctor needs your burdened cost per hour to compute real per-piece costs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2 tracking-tight"><Stethoscope className="w-6 h-6 text-amber-500" /> Price Doctor</h2>
          <p className="text-zinc-500 text-sm mt-0.5">
            Learned cycle times × your burdened ${doctor.burdenedRate.toFixed(0)}/hr — which parts need a price increase.
          </p>
        </div>
        <button onClick={exportCsv} className="bg-zinc-800 hover:bg-zinc-700 border border-white/10 text-zinc-300 px-3 py-2 rounded-xl font-bold flex items-center gap-2 text-sm self-start">
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`rounded-2xl border p-4 ${doctor.totalLeft90d > 0 ? 'bg-red-500/5 border-red-500/25' : 'bg-zinc-900/50 border-white/5'}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Left on the table (90d volume)</p>
          <p className={`text-2xl font-black mt-1 ${doctor.totalLeft90d > 0 ? 'text-red-300' : 'text-zinc-600'}`}>{money(doctor.totalLeft90d, false)}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">if under/thin parts were priced at target</p>
        </div>
        <div className="rounded-2xl border bg-zinc-900/50 border-white/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Underpriced parts</p>
          <p className={`text-2xl font-black mt-1 ${counts.underpriced > 0 ? 'text-red-300' : 'text-zinc-600'}`}>{counts.underpriced}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">margin below 15%</p>
        </div>
        <div className="rounded-2xl border bg-zinc-900/50 border-white/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Healthy parts</p>
          <p className="text-2xl font-black mt-1 text-emerald-300">{counts.healthy}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">≥30% margin — chase more of these</p>
        </div>
        <div className="rounded-2xl border bg-zinc-900/50 border-white/5 p-4">
          <label htmlFor="pd-target" className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">Target margin</label>
          <div className="flex items-center gap-3 mt-1">
            <input id="pd-target" type="range" min={15} max={60} step={5} value={targetMargin} onChange={e => setTargetMargin(+e.target.value)} className="flex-1 accent-amber-500" />
            <span className="text-xl font-black text-amber-300 tabular-nums w-12 text-right">{targetMargin}%</span>
          </div>
          <p className="text-[10px] text-zinc-600 mt-0.5">recommendations recompute live</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search part or customer…" className="w-full bg-zinc-900/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none" />
        </div>
        {(['underpriced', 'no-price', 'thin', 'healthy'] as PriceVerdict[]).map(v => (
          <button key={v} onClick={() => setVerdictFilter(f => f === v ? '' : v)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${verdictFilter === v ? VERDICT_META[v].cls : 'bg-zinc-900/60 border-white/10 text-zinc-500 hover:text-zinc-300'}`}>
            {VERDICT_META[v].label} ({counts[v]})
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-white/5">
          <p className="font-medium">{doctor.parts.length === 0 ? 'No learned cycle data yet.' : 'No parts match your filters.'}</p>
          {doctor.parts.length === 0 && <p className="text-sm mt-1 text-zinc-600">Workers logging pieces-done (session qty) teaches the doctor real cycle times.</p>}
        </div>
      )}

      {/* Parts list */}
      <div className="space-y-2">
        {filtered.map(p => {
          const meta = VERDICT_META[p.verdict];
          const isOpen = expanded === p.partNumber;
          return (
            <div key={p.partNumber} className={`rounded-2xl border overflow-hidden ${p.verdict === 'underpriced' ? 'border-red-500/25 bg-red-500/[0.03]' : 'border-white/5 bg-zinc-900/50'}`}>
              <button onClick={() => setExpanded(isOpen ? null : p.partNumber)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] text-left min-h-[56px]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-white">{p.partNumber}</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${meta.cls}`}>{meta.icon}{meta.label}</span>
                    {p.confidence === 'low' && <span className="text-[9px] font-bold text-zinc-500 border border-white/10 px-1.5 py-0.5 rounded-full" title="Learned from a single run — directional only">low data</span>}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{p.customer || '—'} · {p.runs} run{p.runs !== 1 ? 's' : ''} · {p.volume90d.toLocaleString()} pcs / 90d</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-black tabular-nums">
                    <span className={p.marginNowPct === null ? 'text-zinc-500' : p.marginNowPct < 15 ? 'text-red-300' : p.marginNowPct < 30 ? 'text-orange-300' : 'text-emerald-300'}>
                      {p.currentPricePerPiece === null ? 'no price' : `${money(p.currentPricePerPiece)}/pc · ${Math.round(p.marginNowPct!)}%`}
                    </span>
                  </p>
                  <p className="text-[11px] text-zinc-500 tabular-nums">→ {money(p.recommendedPrice)}/pc @{doctor.targetMarginPct}%{p.moneyLeft90d > 0 ? ` · +${money(p.moneyLeft90d, false)}` : ''}</p>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
              </button>
              {isOpen && (
                <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-fade-in">
                  <div className="bg-zinc-950/50 rounded-lg px-3 py-2"><p className="text-[9px] font-bold uppercase text-zinc-500">Labor</p><p className="text-sm font-black text-white tabular-nums">{p.laborMinPerPiece.toFixed(2)} min/pc</p></div>
                  <div className="bg-zinc-950/50 rounded-lg px-3 py-2"><p className="text-[9px] font-bold uppercase text-zinc-500">Material</p><p className="text-sm font-black text-white tabular-nums">{money(p.materialPerPiece)}/pc</p></div>
                  <div className="bg-zinc-950/50 rounded-lg px-3 py-2"><p className="text-[9px] font-bold uppercase text-zinc-500">True cost</p><p className="text-sm font-black text-amber-300 tabular-nums">{money(p.costPerPiece)}/pc</p></div>
                  <div className="bg-zinc-950/50 rounded-lg px-3 py-2"><p className="text-[9px] font-bold uppercase text-zinc-500">Break-even</p><p className="text-sm font-black text-white tabular-nums">{money(p.breakEvenPrice)}/pc</p></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PricingView;
