// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — <UpgradeNudge>
//
// The "🔒 Purchase Orders is a Pro feature. Upgrade →" card.
// Shown instead of a gated feature when the user's plan doesn't include
// it or their trial has expired.
// ═════════════════════════════════════════════════════════════════════

import React from 'react';
import type { PlanId, TierFeatureKey } from './types';
import { FEATURE_CATALOG, TIER_CATALOG } from './catalog';
import type { GateDenyReason } from './featureFlags';

export interface UpgradeNudgeProps {
  feature: TierFeatureKey;
  requiredTier?: PlanId;
  currentTier?: PlanId;
  reason?: GateDenyReason;
  upgradeUrl: string;
  compact?: boolean;
}

export const UpgradeNudge: React.FC<UpgradeNudgeProps> = ({
  feature,
  requiredTier,
  currentTier,
  reason,
  upgradeUrl,
  compact = false,
}) => {
  const def = FEATURE_CATALOG[feature];
  const tierName = requiredTier ? TIER_CATALOG[requiredTier].name : 'a paid plan';

  const headline =
    reason === 'trial_expired'
      ? 'Your trial ended'
      : reason === 'payment_past_due_grace_expired'
      ? 'Your subscription is past due'
      : reason === 'tenant_paused'
      ? 'Account paused'
      : reason === 'tenant_suspended'
      ? 'Account suspended'
      : `${def.label} is on ${tierName}`;

  const blurb =
    reason === 'trial_expired'
      ? 'Pick a plan to keep using FabTrack IO.'
      : reason === 'payment_past_due_grace_expired'
      ? 'Update your payment method to restore access.'
      : reason === 'tenant_paused'
      ? 'Contact support to reactivate your account.'
      : reason === 'tenant_suspended'
      ? 'Please reach out to support@fabtrack.io.'
      : def.upgradeBlurb ?? `Upgrade to ${tierName} to unlock ${def.label}.`;

  const cta =
    reason === 'trial_expired' || !requiredTier
      ? 'Choose a plan'
      : `Upgrade to ${tierName}`;

  const ctaUrl =
    reason === 'tenant_paused' || reason === 'payment_past_due_grace_expired'
      ? '/billing'
      : upgradeUrl;

  if (compact) {
    return (
      <a
        href={ctaUrl}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition-colors"
        role="button"
      >
        <span aria-hidden>🔒</span>
        <span>{headline}</span>
        <span className="text-amber-300">→</span>
      </a>
    );
  }

  return (
    <div
      role="region"
      aria-label={`${def.label} upgrade required`}
      className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-3xl" aria-hidden>
          🔒
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black uppercase tracking-wider text-amber-200">
            {headline}
          </h3>
          <p className="mt-1 text-sm text-zinc-300">{blurb}</p>
          {currentTier && requiredTier && (
            <p className="mt-2 text-xs text-zinc-500">
              You're on <strong className="text-zinc-300">{TIER_CATALOG[currentTier].name}</strong>
              {' · '}
              This feature needs{' '}
              <strong className="text-amber-300">{TIER_CATALOG[requiredTier].name}</strong>
            </p>
          )}
          <div className="mt-3">
            <a
              href={ctaUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors"
            >
              {cta}
              <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
