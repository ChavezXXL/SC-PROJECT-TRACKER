// ═════════════════════════════════════════════════════════════════════
// /billing/upgrade — Pick a plan + interval, redirect to Stripe Checkout.
//
// Reads pricing from backend/catalog.ts (single source of truth).
// Calls /api/stripe-checkout to mint a Checkout Session, then redirects
// the browser to Stripe's hosted page.
//
// Pre-selects a tier from ?tier=pro URL param (set by upgrade nudges).
// ═════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from 'react';
import { TIER_CATALOG, TIER_ORDER } from '../../backend/catalog';
import type { PlanId } from '../../backend/types';
import { useTenant } from '../../backend/useTenant';
import { AuthShell } from '../auth/AuthShell';

type Interval = 'month' | 'year';

export const UpgradePage: React.FC = () => {
  const { tenant, account, isLegacy } = useTenant();
  const [interval, setInterval] = useState<Interval>('month');
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read ?tier=pro from URL to highlight a recommended plan
  const recommendedTier = useMemo<PlanId | null>(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tier');
      if (t === 'starter' || t === 'pro' || t === 'fabtrack_io') return t;
    } catch {}
    return null;
  }, []);

  async function handleCheckout(planId: PlanId) {
    if (!tenant || !account) {
      setError('You need to be signed in to upgrade.');
      return;
    }
    setBusy(planId);
    setError(null);
    try {
      const origin = window.location.origin;
      const res = await fetch('/api/stripe-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          planId,
          interval,
          email: account.email,
          successUrl: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/billing/upgrade`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Could not start checkout. Try again.');
        setBusy(null);
        return;
      }
      // Redirect to Stripe-hosted checkout
      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || 'Could not reach checkout. Check your connection.');
      setBusy(null);
    }
  }

  // Legacy SC Deburring users don't need a paid plan.
  if (isLegacy) {
    return (
      <AuthShell title="You're on the house">
        <p className="text-sm text-zinc-300 leading-relaxed">
          The SC Deburring install is a legacy tenant — no subscription required.
          Multi-tenant billing applies only to new shops signing up via{' '}
          <a className="text-blue-400 underline" href="/signup">/signup</a>.
        </p>
        <a
          href="/"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-400 hover:text-blue-300"
        >
          ← Back to the app
        </a>
      </AuthShell>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <a href="/" className="inline-flex items-center gap-2 text-sm font-black tracking-tight">
          <span className="inline-block w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-blue-700" />
          FabTrack IO
        </a>
        <a href="/" className="text-xs text-zinc-400 hover:text-zinc-200">← Back to app</a>
      </header>

      <main className="flex-1 px-4 py-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight">Pick your plan</h1>
            <p className="mt-3 text-zinc-400">
              14-day free trial on every plan. Cancel anytime. Your data stays yours.
            </p>

            {/* Monthly / Annual toggle */}
            <div className="inline-flex mt-6 rounded-full bg-zinc-900 border border-white/10 p-1">
              <button
                type="button"
                onClick={() => setInterval('month')}
                className={`px-4 py-1.5 text-sm font-bold rounded-full transition-colors ${
                  interval === 'month' ? 'bg-blue-600 text-white' : 'text-zinc-400'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setInterval('year')}
                className={`px-4 py-1.5 text-sm font-bold rounded-full transition-colors ${
                  interval === 'year' ? 'bg-blue-600 text-white' : 'text-zinc-400'
                }`}
              >
                Annual <span className="text-emerald-400 ml-1">save 16%</span>
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="max-w-md mx-auto mb-6 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-5">
            {TIER_ORDER.map((id) => {
              const plan = TIER_CATALOG[id];
              const price = interval === 'year' ? plan.priceAnnualMonthly : plan.priceMonthly;
              const isPopular = plan.mostPopular;
              const isRecommended = recommendedTier === id;
              return (
                <div
                  key={id}
                  className={`relative rounded-2xl bg-zinc-900/60 border p-6 ${
                    isPopular || isRecommended
                      ? 'border-blue-500/60 shadow-[0_0_60px_-15px_rgba(59,130,246,0.5)]'
                      : 'border-white/10'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 text-[10px] font-black tracking-wider uppercase bg-blue-500 text-white rounded-full">
                      Most popular
                    </div>
                  )}
                  {isRecommended && !isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 text-[10px] font-black tracking-wider uppercase bg-amber-500 text-zinc-950 rounded-full">
                      Recommended
                    </div>
                  )}
                  <h3 className="text-lg font-black tracking-tight">{plan.name}</h3>
                  <p className="mt-1 text-xs text-zinc-400 min-h-[32px]">{plan.tagline}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-black tracking-tight">${price}</span>
                    <span className="text-sm text-zinc-500">/ mo</span>
                  </div>
                  {interval === 'year' && (
                    <p className="text-[11px] text-zinc-500 mt-1">
                      ${plan.priceAnnualMonthly * 12}/year billed once
                    </p>
                  )}

                  <ul className="mt-5 space-y-2 text-xs text-zinc-300">
                    <li>• {plan.maxUsers === null ? 'Unlimited users' : `Up to ${plan.maxUsers} user${plan.maxUsers === 1 ? '' : 's'}`}</li>
                    <li>• {plan.maxJobsPerMonth === null ? 'Unlimited jobs' : `${plan.maxJobsPerMonth} jobs / month`}</li>
                    <li>• {plan.support}</li>
                    <li>• {plan.features.length} features unlocked</li>
                    <li>• 14-day trial</li>
                  </ul>

                  <button
                    type="button"
                    onClick={() => handleCheckout(id)}
                    disabled={busy !== null}
                    className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${
                      isPopular || isRecommended
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-white/10'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {busy === id ? 'Redirecting to Stripe…' : `Choose ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-center text-xs text-zinc-500">
            Powered by Stripe · Pay with card, Apple Pay, Google Pay · Cancel any time
          </p>
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-white/5 text-xs text-zinc-500 text-center">
        © {new Date().getFullYear()} SC Deburring LLC · FabTrack IO
      </footer>
    </div>
  );
};
