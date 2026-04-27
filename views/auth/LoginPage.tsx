// ═════════════════════════════════════════════════════════════════════
// /login — Sign in to FabTrack IO.
//
// On success, AuthProvider's auth-state observer fires, the user's
// tenant is loaded, and the app re-mounts with their data.
// ═════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { logIn, requestPasswordReset } from '../../backend/authService';
import { AuthShell, Field, PrimaryButton, ErrorBanner } from './AuthShell';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await logIn({ email: email.trim(), password });
      window.location.href = '/';
    } catch (e: any) {
      setError(mapAuthError(e));
      setBusy(false);
    }
  }

  async function onForgot() {
    setError(null);
    setResetMsg(null);
    if (!email) {
      setError('Enter your email above first, then click "Forgot password" again.');
      return;
    }
    try {
      await requestPasswordReset(email.trim());
      setResetMsg(`Reset email sent to ${email}. Check your inbox.`);
    } catch (e: any) {
      setError(mapAuthError(e));
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your shop dashboard"
      footer={
        <span>
          Don't have an account?{' '}
          <a href="/signup" className="text-blue-400 hover:text-blue-300 font-semibold">
            Start free trial
          </a>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        {resetMsg && (
          <div role="status" className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-300">
            {resetMsg}
          </div>
        )}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
          disabled={busy}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          disabled={busy}
        />
        <PrimaryButton type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in...' : 'Sign in'}
        </PrimaryButton>
        <button
          type="button"
          onClick={onForgot}
          className="block mx-auto mt-2 text-xs text-zinc-400 hover:text-zinc-200 underline-offset-2 hover:underline"
        >
          Forgot password?
        </button>
      </form>
    </AuthShell>
  );
};

function mapAuthError(e: any): string {
  const code = e?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email or password is incorrect.';
  }
  if (code === 'auth/invalid-email') return 'That email looks invalid.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  if (code === 'auth/user-disabled') return 'This account has been suspended. Contact support.';
  if (code === 'auth/operation-not-allowed') {
    return 'Sign-in is disabled. Owner needs to enable email/password auth in Firebase console.';
  }
  return e?.message || 'Sign-in failed. Try again.';
}

export default LoginPage;
