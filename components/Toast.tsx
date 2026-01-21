import React, { useEffect } from 'react';
import { ToastMessage } from '../types';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose(toast.id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const bgColors = {
    success: 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400',
    error: 'bg-red-500/10 border-red-500/50 text-red-400',
    info: 'bg-blue-500/10 border-blue-500/50 text-blue-400',
  };

  const icons = {
    success: <CheckCircle className="w-5 h-5" />,
    error: <AlertCircle className="w-5 h-5" />,
    info: <Info className="w-5 h-5" />,
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-md shadow-lg mb-3 animate-slide-in-right transition-all transform ${bgColors[toast.type]}`}>
      {icons[toast.type]}
      <p className="text-sm font-medium">{toast.message}</p>
      <button onClick={() => onClose(toast.id)} className="ml-auto hover:text-white transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
