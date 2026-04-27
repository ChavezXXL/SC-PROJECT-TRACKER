// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — useFeatureGate() React hook
//
// Thin hook around `isFeatureEnabled()`. Returns the gate result for a
// given feature plus any state from `useTenant()`.
// ═════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { TierFeatureKey } from './types';
import {
  isFeatureEnabled,
  type GateResult,
} from './featureFlags';
import { useTenant } from './useTenant';

export interface UseFeatureGate extends GateResult {
  /** Deep-link the upgrade nudge sends users to. */
  upgradeUrl: string;
}

const BASE_UPGRADE_URL = '/billing/upgrade';

export function useFeatureGate(feature: TierFeatureKey, packFlags?: Record<string, boolean>): UseFeatureGate {
  const { tenant, subscription, account } = useTenant();

  return useMemo<UseFeatureGate>(() => {
    const result = isFeatureEnabled({
      feature,
      tenant,
      subscription,
      account,
      packFlags,
    });
    const qs = new URLSearchParams({ feature });
    if (result.requiredTier) qs.set('tier', result.requiredTier);
    return {
      ...result,
      upgradeUrl: `${BASE_UPGRADE_URL}?${qs.toString()}`,
    };
  }, [feature, tenant, subscription, account, packFlags]);
}
