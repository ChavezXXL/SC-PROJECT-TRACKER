// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — <FeatureGate> wrapper
//
// Wraps a piece of UI. When the feature is allowed, renders children.
// When denied because of plan/trial, renders the <UpgradeNudge>.
// When denied because the pack is off, renders nothing (not relevant).
//
// Usage:
//   <FeatureGate feature="purchaseOrders">
//     <NavItem icon={Package} label="Purchasing" />
//   </FeatureGate>
//
// You can also opt out of the nudge (hide entirely when denied):
//   <FeatureGate feature="purchaseOrders" mode="hide">
//     <NavItem ... />
//   </FeatureGate>
// ═════════════════════════════════════════════════════════════════════

import React from 'react';
import type { TierFeatureKey } from './types';
import { useFeatureGate } from './useFeatureGate';
import { UpgradeNudge } from './UpgradeNudge';

export interface FeatureGateProps {
  feature: TierFeatureKey;
  /** How to render when the feature is denied.
   *   - 'nudge' (default) shows the UpgradeNudge card
   *   - 'hide' renders nothing
   *   - 'fallback' renders the `fallback` prop */
  mode?: 'nudge' | 'hide' | 'fallback';
  fallback?: React.ReactNode;
  /** Pack flags passed through — usually from SystemSettings.enabledFeatures. */
  packFlags?: Record<string, boolean>;
  /** When true, wraps children in a disabled/opaque overlay instead of hiding. */
  softDisabled?: boolean;
  children: React.ReactNode;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  mode = 'nudge',
  fallback = null,
  packFlags,
  softDisabled = false,
  children,
}) => {
  const gate = useFeatureGate(feature, packFlags);

  if (gate.allowed) return <>{children}</>;

  // Pack turned off → feature not relevant for this shop. Hide entirely.
  if (gate.reason === 'pack_off') return null;

  if (mode === 'hide') return null;
  if (mode === 'fallback') return <>{fallback}</>;

  if (softDisabled) {
    return (
      <div className="relative opacity-40 pointer-events-none" aria-disabled="true">
        {children}
      </div>
    );
  }

  return (
    <UpgradeNudge
      feature={feature}
      requiredTier={gate.requiredTier}
      currentTier={gate.currentTier}
      reason={gate.reason}
      upgradeUrl={gate.upgradeUrl}
    />
  );
};
