import React, { useEffect } from 'react';
import { ToastMessage } from '../types';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  // Problems stay up longer — they're the ones people need to read.
  const ms = toast.type === 'error' ? 9000 : 5000;
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, ms);
    return () => clearTimeout(timer);
  }, [toast.id, onClose, ms]);

  // Solid backgrounds: the see-through ones were hard to read over a busy screen.
  const colors = {
    success: 'bg-zinc-900 border-emerald-500/60 text-emerald-300',
    error: 'bg-zinc-900 border-red-500/70 text-red-300',
    info: 'bg-zinc-900 border-blue-500/60 text-blue-200',
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5 shrink-0" aria-hidden="true" />,
    error: <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />,
    info: <Info className="w-5 h-5 shrink-0" aria-hidden="true" />,
  };

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      // Taps go straight through to whatever is underneath (it sits above
      // dialogs, often over a Save button) — only the dismiss button catches them.
      className={`pointer-events-none flex items-center gap-3 pl-4 pr-2 py-3 rounded-xl border-2 shadow-2xl shadow-black/50 animate-slide-in-right w-full sm:w-auto sm:max-w-md ${colors[toast.type]}`}
    >
      {icons[toast.type]}
      <p className="text-sm sm:text-[15px] font-semibold leading-snug text-white/95">{toast.message}</p>
      <button type="button" onClick={() => onClose(toast.id)} aria-label="Dismiss" className="pointer-events-auto ml-auto shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
