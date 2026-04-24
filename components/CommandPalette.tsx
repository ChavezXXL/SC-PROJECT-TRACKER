// ═════════════════════════════════════════════════════════════════════
// Command Palette — Cmd+K / Ctrl+K quick launcher.
//
// A power-user shortcut that floats over the app. Type to fuzzy-match
// against navigation, recent jobs, and quick actions. Hit Enter to jump.
//
// Why it earns its keep:
//   • The sidebar has 12+ sections — mouse travel slows admins down.
//   • Shop owners often want to "jump to PO-1234" across many jobs.
//   • Adds pro polish that feels like Linear, Vercel, Raycast.
//
// Keyboard UX:
//   Cmd+K / Ctrl+K — open/close
//   ↑ ↓            — navigate
//   Enter          — run
//   Esc            — close
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Briefcase, Columns3, Calendar, Activity, History, FileText,
  Camera, AlertTriangle, Calculator, Users, Settings as SettingsIcon,
  LayoutDashboard, ScanLine, Truck, ArrowRight, Bell,
} from 'lucide-react';
import type { Job } from '../types';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: any;
  keywords?: string[];
  action: () => void;
  /** Score bonus for pinned / recent. */
  pinBoost?: number;
  group: 'Navigate' | 'Jobs' | 'Actions';
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: string) => void;
  jobs: Job[];
  /** Opens a job modal by id. When omitted, fallback to navigating to jobs. */
  onOpenJob?: (jobId: string) => void;
  /** Extra one-shot actions (e.g. "New Job", "Scan PO"). */
  extraActions?: Array<{ id: string; label: string; icon: any; action: () => void }>;
}

export const CommandPalette: React.FC<Props> = ({ open, onClose, onNavigate, jobs, onOpenJob, extraActions = [] }) => {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // iOS Safari needs the frame yield for autofocus
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Navigation items — mirrors the sidebar so users learn the shortcut once.
  const navItems: CommandItem[] = useMemo(() => [
    { id: 'nav-dash',        label: 'Overview',     icon: LayoutDashboard, action: () => onNavigate('admin-dashboard'), group: 'Navigate', keywords: ['home', 'dashboard'] },
    { id: 'nav-jobs',        label: 'Jobs',         icon: Briefcase,       action: () => onNavigate('admin-jobs'),      group: 'Navigate' },
    { id: 'nav-board',       label: 'Job Board',    icon: Columns3,        action: () => onNavigate('admin-board'),     group: 'Navigate', keywords: ['kanban', 'pipeline', 'stages'] },
    { id: 'nav-calendar',    label: 'Calendar',     icon: Calendar,        action: () => onNavigate('admin-calendar'),  group: 'Navigate' },
    { id: 'nav-live',        label: 'Live Floor',   icon: Activity,        action: () => onNavigate('admin-live'),      group: 'Navigate', keywords: ['tv', 'workers', 'running'] },
    { id: 'nav-logs',        label: 'Logs',         icon: History,         action: () => onNavigate('admin-logs'),      group: 'Navigate', keywords: ['time', 'timesheets'] },
    { id: 'nav-quotes',      label: 'Quotes',       icon: FileText,        action: () => onNavigate('admin-quotes'),    group: 'Navigate' },
    { id: 'nav-samples',     label: 'Samples',      icon: Camera,          action: () => onNavigate('admin-samples'),   group: 'Navigate', keywords: ['photos', 'fai'] },
    { id: 'nav-quality',     label: 'Quality',      icon: AlertTriangle,   action: () => onNavigate('admin-quality'),   group: 'Navigate', keywords: ['rework', 'ncr'] },
    { id: 'nav-deliveries',  label: 'Deliveries',   icon: Truck,           action: () => onNavigate('admin-deliveries'),group: 'Navigate', keywords: ['driver', 'miles', 'gps'] },
    { id: 'nav-reports',     label: 'Reports',      icon: Calculator,      action: () => onNavigate('admin-reports'),   group: 'Navigate', keywords: ['revenue', 'margin'] },
    { id: 'nav-team',        label: 'Team',         icon: Users,           action: () => onNavigate('admin-team'),      group: 'Navigate', keywords: ['workers', 'employees'] },
    { id: 'nav-scan',        label: 'Work Station', icon: ScanLine,        action: () => onNavigate('admin-scan'),      group: 'Navigate', keywords: ['kiosk'] },
    { id: 'nav-settings',    label: 'Settings',     icon: SettingsIcon,    action: () => onNavigate('admin-settings'),  group: 'Navigate' },
  ], [onNavigate]);

  // Jobs — fuzzy-matchable by PO, part, customer. Cap to open jobs first so
  // the list doesn't drown in completed history.
  const jobItems: CommandItem[] = useMemo(() => {
    return jobs.map(j => ({
      id: `job-${j.id}`,
      label: `PO ${j.poNumber}`,
      sublabel: `${j.partNumber}${j.customer ? ` · ${j.customer}` : ''}${j.status === 'completed' ? ' · ✓' : ''}`,
      icon: Briefcase,
      action: () => {
        if (onOpenJob) onOpenJob(j.id);
        else onNavigate('admin-jobs');
      },
      keywords: [j.partNumber, j.customer || '', j.jobIdsDisplay || ''],
      pinBoost: j.status !== 'completed' ? 1 : 0,
      group: 'Jobs',
    } as CommandItem));
  }, [jobs, onNavigate, onOpenJob]);

  // Extra action buttons (New Job, Scan PO, etc.) wired in by the caller.
  const actionItems: CommandItem[] = useMemo(() => {
    return extraActions.map(a => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      action: () => { a.action(); onClose(); },
      group: 'Actions',
    } as CommandItem));
  }, [extraActions, onClose]);

  // Very small fuzzy matcher: all query tokens must appear (in any order)
  // somewhere in label/sublabel/keywords. Score = boost + count of matches.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...actionItems, ...navItems, ...jobItems];
    if (!q) {
      // Default view when empty: actions first, then nav, then a few open jobs
      return [
        ...actionItems,
        ...navItems,
        ...jobItems.filter(i => (i.pinBoost || 0) > 0).slice(0, 6),
      ];
    }
    const tokens = q.split(/\s+/);
    const scored = all.map(item => {
      const haystack = [item.label, item.sublabel || '', ...(item.keywords || [])].join(' ').toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (!haystack.includes(t)) return { item, score: -1 };
        // Prefix bonus — typing "jo" should rank "Jobs" above "Reports"
        if (item.label.toLowerCase().startsWith(t)) score += 3;
        else if (haystack.startsWith(t)) score += 2;
        else score += 1;
      }
      score += item.pinBoost || 0;
      return { item, score };
    }).filter(r => r.score >= 0).sort((a, b) => b.score - a.score);
    return scored.slice(0, 25).map(r => r.item);
  }, [query, actionItems, navItems, jobItems]);

  // Keep cursor in range as results change
  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [results.length, cursor]);

  // Key handling
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(results.length - 1, c + 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        const sel = results[cursor];
        if (sel) { sel.action(); onClose(); }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, results, cursor, onClose]);

  if (!open) return null;

  // Group headers for nicer presentation
  const grouped: Record<string, CommandItem[]> = {};
  for (const r of results) {
    (grouped[r.group] ||= []).push(r);
  }

  // Portal to body so the palette floats above EVERYTHING — sidebar, modals,
  // TV mode. Responsive offset: less pushed-down on mobile where vh is tight.
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/70 backdrop-blur-sm pt-[6vh] sm:pt-[10vh] px-3 sm:px-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: 'min(70vh, calc(100dvh - 8rem))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
          <Search className="w-4 h-4 text-zinc-500 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            placeholder="Type to jump: a job, a page, an action…"
            className="flex-1 bg-transparent outline-none text-white text-sm placeholder:text-zinc-600"
          />
          <kbd className="hidden sm:inline text-[10px] text-zinc-600 font-mono bg-zinc-950 border border-white/10 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No matches for "{query}"
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="py-1">
                <p className="px-4 py-1 text-[9px] font-black text-zinc-600 uppercase tracking-widest">{group}</p>
                {items.map(item => {
                  const Icon = item.icon;
                  const isActive = results[cursor]?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setCursor(results.indexOf(item))}
                      onClick={() => { item.action(); onClose(); }}
                      className={`w-full px-4 py-2 flex items-center gap-3 text-left transition-colors ${isActive ? 'bg-blue-500/15' : 'hover:bg-white/[0.03]'}`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-zinc-500'}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-bold truncate ${isActive ? 'text-white' : 'text-zinc-200'}`}>{item.label}</p>
                        {item.sublabel && <p className="text-[11px] text-zinc-500 truncate">{item.sublabel}</p>}
                      </div>
                      {isActive && <ArrowRight className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-white/5 bg-zinc-950/60 flex items-center justify-between text-[10px] text-zinc-600">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="bg-zinc-800 border border-white/10 rounded px-1">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="bg-zinc-800 border border-white/10 rounded px-1">Enter</kbd> select</span>
          </div>
          <span>{results.length} match{results.length === 1 ? '' : 'es'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Hook: installs the global Cmd+K / Ctrl+K shortcut.
 * Returns [open, setOpen] so callers don't duplicate state.
 */
export function useCommandPalette(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Respect when the user is inside a contentEditable — don't hijack
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
          // Still open on Cmd+K even in an input — power users expect this
        }
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return [open, setOpen];
}
