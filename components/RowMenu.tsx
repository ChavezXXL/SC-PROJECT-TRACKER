/**
 * RowMenu — a "⋯" button that opens a small menu of less-used row actions.
 *
 * The menu is portaled and fixed-positioned from the button's rect, so a
 * table inside an overflow-x-auto wrapper can't clip it. Closes on outside
 * tap, Esc, scroll or resize.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export const RowMenu = ({ items, label = 'More actions' }: { items: RowMenuItem[]; label?: string }) => {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = items.filter(i => !i.hidden);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  if (visible.length === 0) return null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btnRef.current!.getBoundingClientRect();
    // Open upward when the button is near the bottom of the screen.
    const menuH = visible.length * 40 + 8;
    const top = r.bottom + 4 + menuH > window.innerHeight ? Math.max(8, r.top - 4 - menuH) : r.bottom + 4;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle} aria-label={label} aria-haspopup="menu" aria-expanded={!!pos}
        title={label}
        className={`p-2 rounded-lg transition-colors ${pos ? 'bg-zinc-700 text-white' : 'hover:bg-zinc-800 text-zinc-400 hover:text-white'}`}>
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
      </button>
      {pos && createPortal(
        <div ref={menuRef} role="menu" onClick={e => e.stopPropagation()}
          className="fixed z-[200] min-w-[200px] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/60 p-1 animate-fade-in"
          style={{ top: pos.top, right: pos.right }}>
          {visible.map(item => (
            <button key={item.label} type="button" role="menuitem"
              onClick={() => { setPos(null); item.onSelect(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 min-h-[40px] rounded-lg text-left text-sm font-semibold transition-colors ${item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-zinc-200 hover:bg-white/5'}`}>
              {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

export default RowMenu;
