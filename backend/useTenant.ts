// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — useTenant() React hook
//
// Lightweight subscription to "which tenant am I in + what's my plan?".
// Handles the legacy fallback (SC Deburring) transparently — callers never
// need to know whether they're on flat or scoped Firestore paths.
//
// Wiring in Phase 1 → plumb through React context instead of this stub.
// Right now it just synthesizes a legacy tenant so gates resolve correctly
// in preview / dev.
// ═════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { Account, Subscription, Tenant } from './types';
import { LEGACY_TENANT_ID, buildLegacyTenant } from './tenantContext';
import { buildLegacySuperAccount } from './authService';

export interface TenantHookResult {
  tenant: Tenant | null;
  subscription: Subscription | null;
  account: Account | null;
  isLoading: boolean;
  /** Did we fall back to the legacy tenant (SC Deburring)? */
  isLegacy: boolean;
}

/**
 * Returns the current tenant + subscription + account.
 *
 * Phase 0 behavior: synthesizes the legacy SC Deburring tenant unconditionally
 * so feature gates in dev resolve to "allow everything" via the legacy bypass.
 *
 * Phase 1+ behavior: subscribes to `tenants/{id}` + `subscription/current` +
 * `accounts/{uid}` from Firestore.
 */
export function useTenant(): TenantHookResult {
  return useMemo<TenantHookResult>(() => {
    const account = buildLegacySuperAccount();
    const tenant = buildLegacyTenant(account.uid);
    // Legacy tenant has no subscription; the gate's legacy bypass makes this fine.
    return {
      tenant,
      subscription: null,
      account,
      isLoading: false,
      isLegacy: tenant.id === LEGACY_TENANT_ID,
    };
  }, []);
}
