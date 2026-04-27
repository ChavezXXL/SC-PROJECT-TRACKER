// ═════════════════════════════════════════════════════════════════════
// /signup — Create a FabTrack IO account + tenant.
//
// Flow: user fills email + password + shop name → signUp() creates
//   • Firebase Auth user
//   • accounts/{uid}
//   • tenants/{slug}
//   • tenants/{slug}/members/{uid} role=owner
//   • tenants/{slug}/subscription/current status=trialing 14d
// → redirect to /overview where the existing app loads with their
//   fresh empty tenant.
// ═════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { signUp } from '../../backend/authService';
import { AuthShell, Field, PrimaryButton, ErrorBanner } from './AuthShell';

export const SignupPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shopName, setShopName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await signUp({
        email: email.trim(),
        password,
        tenantName: shopName.trim(),
      });
      // Tenant + trial created. Redirect into the app — full reload so
      // the app re-resolves the tenant from auth context.
      window.location.href = '/';
    } catch (e: any) {
      const msg = mapAuthError(e);
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Start your free trial"
      subtitle="14 days · no credit card required"
      footer={
        <span>
          Already have an account?{' '}
          <a href="/login" className="text-blue-400 hover:text-blue-300 font-semibold">
            Sign in
          </a>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <Field
          label="Shop name"
          value={shopName}
          onChange={setShopName}
          placeholder="Acme Machining"
          autoComplete="organization"
          required
          disabled={busy}
        />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@yourshop.com"
          autoComplete="email"
          required
          disabled={busy}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
          disabled={busy}
          hint="We'll send a verification email after signup."
        />
        <PrimaryButton type="submit" disabled={busy || !email || !password || !shopName}>
          {busy ? 'Creating your shop...' : 'Start 14-day free trial'}
        </PrimaryButton>
        <p className="text-[11px] text-zinc-500 text-center pt-1">
          By creating an account you agree to the Terms of Service and Privacy Policy.
        </p>
      </form>
    </AuthShell>
  );
};

function mapAuthError(e: any): string {
  const code = e?.code || '';
  const msg = e?.message || 'Something went wrong. Try again.';
  if (code === 'auth/email-already-in-use') return 'An account with that email already exists. Try signing in.';
  if (code === 'auth/invalid-email') return 'That email looks invalid.';
  if (code === 'auth/weak-password') return 'Password is too weak. Use at least 8 characters.';
  if (code === 'auth/operation-not-allowed') {
    return 'Email/password sign-in is not enabled in Firebase yet. Owner: enable it at console.firebase.google.com → Authentication → Sign-in method.';
  }
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  return msg;
}

export default SignupPage;
