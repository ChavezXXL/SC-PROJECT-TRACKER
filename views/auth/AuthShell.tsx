// ═════════════════════════════════════════════════════════════════════
// AuthShell — full-screen layout used by Signup + Login pages.
//
// Single-column dark layout matching the app's vibe (zinc-950 bg, blue
// accent). Lets the form components stay focused on their fields.
// ═════════════════════════════════════════════════════════════════════

import React, { type ReactNode } from 'react';

export const AuthShell: React.FC<{
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}> = ({ title, subtitle, children, footer }) => {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Top brand bar */}
      <header className="px-6 py-4 border-b border-white/5">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-black tracking-tight">
          <span className="inline-block w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-blue-700" />
          <span>FabTrack IO</span>
        </a>
      </header>

      {/* Centered card */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-black tracking-tight">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>}
          </div>
          <div className="rounded-2xl bg-zinc-900/60 border border-white/10 p-6 backdrop-blur">
            {children}
          </div>
          {footer && <div className="mt-4 text-center text-sm text-zinc-400">{footer}</div>}
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-white/5 text-xs text-zinc-500 text-center">
        © {new Date().getFullYear()} SC Deburring LLC · FabTrack IO
      </footer>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Tiny shared inputs/buttons so both pages stay consistent
// ─────────────────────────────────────────────────────────────────────

export const Field: React.FC<{
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}> = ({ label, type = 'text', value, onChange, placeholder, autoComplete, required, disabled, hint }) => (
  <label className="block">
    <span className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      required={required}
      disabled={disabled}
      className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
    />
    {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
  </label>
);

export const PrimaryButton: React.FC<{
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}> = ({ type = 'button', onClick, disabled, children }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-bold text-white transition-colors"
  >
    {children}
  </button>
);

export const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div role="alert" className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
    {message}
  </div>
);
