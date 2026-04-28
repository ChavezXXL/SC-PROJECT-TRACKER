// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — useTenant() React hook
//
// Returns the current tenant + subscription + account based on auth
// state. Feature gates and tenant-aware UI consume this.
//
// Resolution order:
//   1. AuthContext provides a signed-in account → load that account's
//      current tenant from `tenants[]`. Synthesize an optimistic Pro
//      trial subscription until Phase 3 wires real Firestore reads.
//   2. No signed-in account → fall back to the legacy SC Deburring
//      synthetic super-account so the existing app keeps working
//      identically.
// ═════════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { Account, PlanId, Subscription, Tenant } from './types';
import { LEGACY_TENANT_ID, buildLegacyTenant } from './tenantContext';
import { buildLegacySuperAccount } from './authService';
import { useAuth } from './AuthContext';

export interface TenantHookResult {
  tenant: Tenant | null;
  subscription: Subscription | null;
  account: Account | null;
  isLoading: boolean;
  /** Did we fall back to the legacy tenant (SC Deburring)? */
  isLegacy: boolean;
}

/** Default plan applied to fresh signups before Phase 3 (Stripe) loads
 *  the real subscription doc. Lets new tenants see Pro-tier features
 *  during their trial. */
const FALLBACK_TRIAL_PLAN: PlanId = 'pro';
const TRIAL_DAYS = 14;

export function useTenant(): TenantHookResult {
  const { account, tenants, currentTenantId, isLoading } = useAuth();

  return useMemo<TenantHookResult>(() => {
    // ── Signed in: real tenant from auth context ───────────────────
    if (account && currentTenantId) {
      const tenant = tenants.find((t) => t.id === currentTenantId) || null;
      // Optimistic Pro-tier trial subscription. Replaced by real Firestore
      // subscription doc when Phase 3 ships.
      const subscription: Subscription | null = tenant
        ? {
            tenantId: tenant.id,
            planId: FALLBACK_TRIAL_PLAN,
            status: 'trialing',
            interval: 'month',
            seats: 1,
            trialStartedAt: tenant.createdAt,
            trialEndsAt: tenant.createdAt + TRIAL_DAYS * 24 * 60 * 60 * 1000,
            updatedAt: Date.now(),
          }
        : null;
      return {
        tenant,
        subscription,
        account,
        isLoading,
        isLegacy: tenant?.isLegacy === true,
      };
    }

    // ── Not signed in: legacy SC Deburring fallback ────────────────
    const legacyAccount = buildLegacySuperAccount();
    const legacyTenant = buildLegacyTenant(legacyAccount.uid);
    return {
      tenant: legacyTenant,
      subscription: null,
      account: legacyAccount,
      isLoading,
      isLegacy: legacyTenant.id === LEGACY_TENANT_ID,
    };
  }, [account, tenants, currentTenantId, isLoading]);
}
