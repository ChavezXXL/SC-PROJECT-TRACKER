// ═════════════════════════════════════════════════════════════════════
// <TrialBanner /> — top-of-app banner showing trial countdown.
//
// Renders only when the active tenant is on a trialing subscription.
// Gentle in the first half of the trial, urgent in the last 3 days,
// red + soft paywall CTA when expired.
//
// Mount once in App.tsx near the top of the layout.
//
// Hidden for the legacy SC Deburring tenant — it doesn't have a sub.
// ═════════════════════════════════════════════════════════════════════

import React from 'react';
import { useTenant } from '../backend/useTenant';
import { trialDaysRemaining } from '../backend/featureFlags';

export const TrialBanner: React.FC = () => {
  const { subscription, isLegacy } = useTenant();

  // No banner for SC Deburring (legacy) — no subscription concept applies.
  if (isLegacy) return null;
  if (!subscription || subscription.status !== 'trialing') return null;

  const days = trialDaysRemaining(subscription) ?? 0;
  const urgent = days <= 3;
  const expired = days <= 0;

  const tone = expired
    ? 'bg-red-500/15 border-red-500/40 text-red-100'
    : urgent
    ? 'bg-amber-500/15 border-amber-500/40 text-amber-100'
    : 'bg-blue-500/10 border-blue-500/30 text-blue-100';

  const message = expired
    ? 'Your free trial ended. Pick a plan to keep going.'
    : urgent
    ? `${days} day${days === 1 ? '' : 's'} left on your trial.`
    : `${days} days left on your free trial.`;

  return (
    <div
      role="status"
      className={`relative z-40 border-b ${tone} px-4 py-2.5 flex items-center justify-center gap-3 text-sm font-medium`}
    >
      <span aria-hidden>{expired ? '⏰' : urgent ? '⚠️' : '✨'}</span>
      <span>{message}</span>
      <a
        href="/billing/upgrade"
        className="ml-2 inline-flex items-center gap-1 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider transition-colors"
      >
        {expired ? 'Choose plan' : 'Upgrade'}
        <span aria-hidden>→</span>
      </a>
    </div>
  );
};
