/**
 * ShopActionsPanel — "assigned, dated, measurable."
 * The owner's action list on the dashboard: add a to-do, assign it to a
 * person, give it a date, check it off. Brain insights can be promoted into
 * actions from the ShopBrainPanel ("→ Make task"). Ideas become work.
 */
import React, { useMemo, useState } from 'react';
import {
  ClipboardCheck, Plus, ChevronDown, ChevronUp, Trash2, Calendar, User as UserIcon, Check,
} from 'lucide-react';
import type { ShopAction, User } from '../types';
import * as DB from '../services/mockDb';

const todayYmd = (): number => {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};
const dueYmd = (due?: string): number => {
  const m = (due || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? (+m[3]) * 10000 + (+m[1]) * 100 + (+m[2]) : 0;
};
/** YYYY-MM-DD (date input) ↔ MM/DD/YYYY (stored) */
const fromDateInput = (s: string): string => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
};

export const ShopActionsPanel = ({ actions, users, currentUserName, addToast }: {
  actions: ShopAction[]; users: User[]; currentUserName?: string; addToast: (t: string, m: string) => void;
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return sessionStorage.getItem('actions_collapsed') === '1'; } catch { return false; }
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [showDone, setShowDone] = useState(false);

  const tYmd = todayYmd();
  const { open, done } = useMemo(() => {
    const open = actions.filter(a => !a.done).sort((a, b) => {
      const da = dueYmd(a.dueDate) || 99999999, db = dueYmd(b.dueDate) || 99999999;
      return da - db || a.createdAt - b.createdAt;      // due-soonest first, undated last
    });
    const done = actions.filter(a => a.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 8);
    return { open, done };
  }, [actions]);
  const overdue = open.filter(a => dueYmd(a.dueDate) > 0 && dueYmd(a.dueDate) < tYmd).length;

  const toggle = () => setCollapsed(prev => {
    const next = !prev;
    try { sessionStorage.setItem('actions_collapsed', next ? '1' : '0'); } catch {}
    return next;
  });

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      await DB.saveShopAction({
        id: crypto.randomUUID(),
        title: t,
        ownerName: owner || undefined,
        dueDate: due ? fromDateInput(due) : undefined,
        done: false,
        createdAt: Date.now(),
        createdBy: currentUserName,
        source: 'manual',
      });
      setTitle(''); setOwner(''); setDue(''); setAdding(false);
      addToast('success', 'Action added');
    } catch { addToast('error', 'Could not save action'); }
  };

  const setDone = async (a: ShopAction, val: boolean) => {
    try { await DB.saveShopAction({ ...a, done: val, doneAt: val ? Date.now() : undefined }); }
    catch { addToast('error', 'Update failed'); }
  };
  const remove = async (a: ShopAction) => {
    try { await DB.deleteShopAction(a.id); } catch { addToast('error', 'Delete failed'); }
  };

  const Row = ({ a }: { a: ShopAction }) => {
    const d = dueYmd(a.dueDate);
    const isOver = !a.done && d > 0 && d < tYmd;
    const isToday = !a.done && d === tYmd;
    return (
      <div className={`group flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-colors ${a.done ? 'bg-zinc-950/30 border-white/5 opacity-60' : isOver ? 'bg-red-500/5 border-red-500/20' : 'bg-zinc-950/50 border-white/5 hover:border-white/10'}`}>
        <button onClick={() => setDone(a, !a.done)} aria-label={a.done ? 'Mark not done' : 'Mark done'}
          className={`w-6 h-6 min-h-0 rounded-lg border-2 flex items-center justify-center shrink-0 transition-colors ${a.done ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600 hover:border-emerald-400'}`}>
          {a.done && <Check className="w-3.5 h-3.5 text-white" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${a.done ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>
            {a.source === 'brain' && <span className="mr-1" title="From the Shop Brain">🧠</span>}{a.title}
          </p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {a.ownerName && <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-0.5"><UserIcon className="w-2.5 h-2.5" />{a.ownerName}</span>}
            {a.dueDate && (
              <span className={`text-[10px] font-bold flex items-center gap-0.5 ${isOver ? 'text-red-400' : isToday ? 'text-amber-300' : 'text-zinc-500'}`}>
                <Calendar className="w-2.5 h-2.5" />{isOver ? `${a.dueDate} — overdue` : isToday ? 'today' : a.dueDate}
              </span>
            )}
          </div>
        </div>
        <button onClick={() => remove(a)} aria-label="Delete action" className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      <button onClick={toggle} className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-4 h-4 text-violet-400" aria-hidden="true" />
          </div>
          <div className="min-w-0 text-left">
            <p className="text-sm font-black text-white tracking-tight flex items-center gap-2">
              Shop Actions
              {open.length > 0 && <span className="text-[10px] font-black text-violet-300 bg-violet-500/15 border border-violet-500/25 px-1.5 py-0.5 rounded-full">{open.length}</span>}
              {overdue > 0 && <span className="text-[10px] font-black text-red-300 bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded-full">{overdue} overdue</span>}
            </p>
            <p className="text-[11px] text-zinc-500 truncate">Assigned, dated, checked off — ideas become work</p>
          </div>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" /> : <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-1.5">
          {open.map(a => <Row key={a.id} a={a} />)}
          {open.length === 0 && !adding && <p className="text-xs text-zinc-600 text-center py-3">Nothing open — add one, or promote a Brain insight.</p>}

          {adding ? (
            <div className="bg-zinc-950/60 border border-violet-500/25 rounded-xl p-3 space-y-2">
              <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }}
                placeholder="What needs to happen?" className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-violet-500/50" />
              <div className="flex gap-2 flex-wrap">
                <select value={owner} onChange={e => setOwner(e.target.value)} aria-label="Assign to" className="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-300">
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
                <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" className="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-zinc-300 [color-scheme:dark]" />
                <div className="flex-1" />
                <button onClick={() => setAdding(false)} className="text-xs font-bold text-zinc-500 hover:text-white px-2">Cancel</button>
                <button onClick={add} disabled={!title.trim()} className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-lg">Add</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-violet-300 border border-dashed border-white/10 hover:border-violet-500/30 rounded-xl py-2.5 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add action
            </button>
          )}

          {done.length > 0 && (
            <div className="pt-1">
              <button onClick={() => setShowDone(s => !s)} className="text-[10px] font-bold text-zinc-600 hover:text-zinc-400 flex items-center gap-1">
                {showDone ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} Done ({done.length})
              </button>
              {showDone && <div className="space-y-1.5 mt-1.5">{done.map(a => <Row key={a.id} a={a} />)}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShopActionsPanel;
