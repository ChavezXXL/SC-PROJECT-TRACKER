// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — Central Feature Gate
//
// Every time a UI element wants to know "is this feature available?",
// it calls `isFeatureEnabled()`. That's the only function that reads
// subscription + tenant + shop-profile state and returns a definitive
// allow/deny answer.
//
// Gate layers (all must pass):
//   1. Tenant status — not suspended / canceled / banned
//   2. Account status — owner/member not banned
//   3. Tier — subscription plan includes the feature
//   4. Pack — shop profile says it's relevant (optional layer)
//   5. Override — operator comp / feature override can force enable
//
// LEGACY BYPASS: If `tenant.isLegacy === true`, return `allowed: true`
// unconditionally. This keeps the SC Deburring install running with no
// changes during the rollout.
// ═════════════════════════════════════════════════════════════════════

import type {
  Account,
  PlanId,
  Subscription,
  Tenant,
  TierFeatureKey,
} from './types';
import { FEATURE_CATALOG, TIER_CATALOG, tierMeetsMin } from './catalog';

// Types local to the gate result
export type GateDenyReason =
  | 'tenant_suspended'      // operator banned the tenant
  | 'tenant_canceled'       // customer canceled
  | 'tenant_paused'         // 30+ days unpaid
  | 'account_banned'        // single user banned
  | 'trial_expired'         // trial over, no subscription
  | 'payment_past_due_grace_expired'  // past_due > grace
  | 'plan'                  // current plan doesn't include feature
  | 'pack_off'              // shop profile has the feature turned off
  | 'limit_reached';        // usage cap hit

export interface GateResult {
  allowed: boolean;
  reason?: GateDenyReason;
  /** The minimum plan the user must upgrade to in order to unlock. */
  requiredTier?: PlanId;
  /** The plan they currently have, for context in upgrade nudges. */
  currentTier?: PlanId;
  /** Human-readable explanation for devtools / debug panels. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────

/** Soft-paywall grace after a failed payment (days). */
export const PAYMENT_GRACE_DAYS = 3;
/** Hard-pause threshold after unpaid (days). */
export const PAUSE_THRESHOLD_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────
// Main API
// ─────────────────────────────────────────────────────────────────────

export interface FeatureGateInput {
  feature: TierFeatureKey;
  tenant: Tenant | null;
  subscription: Subscription | null;
  account?: Account | null;
  /** Per-shop pack flags from `settings.enabledFeatures` — legacy deriveFeatures(). */
  packFlags?: Record<string, boolean>;
  /** Current timestamp, defaults to Date.now(). Passed in for deterministic tests. */
  now?: number;
}

export function isFeatureEnabled(input: FeatureGateInput): GateResult {
  const now = input.now ?? Date.now();
  const { feature, tenant, subscription, account, packFlags } = input;

  // ── Legacy bypass — SC Deburring keeps everything
  if (tenant?.isLegacy) {
    return { allowed: true, note: 'legacy_tenant_bypass' };
  }

  // ── Super-admin bypass — god-mode account sees everything
  if (account?.superAdmin) {
    return { allowed: true, note: 'super_admin_bypass' };
  }

  // ── Tenant-level blockers (check before plan)
  if (!tenant) {
    return { allowed: false, reason: 'tenant_suspended', note: 'no_tenant' };
  }
  if (tenant.status === 'suspended') {
    return { allowed: false, reason: 'tenant_suspended' };
  }
  if (tenant.status === 'canceled') {
    return { allowed: false, reason: 'tenant_canceled' };
  }
  if (tenant.status === 'paused') {
    return { allowed: false, reason: 'tenant_paused' };
  }

  // ── Account-level blocker
  if (account?.banned) {
    return { allowed: false, reason: 'account_banned' };
  }

  // ── Determine effective tier
  //   Priority: (1) operator comp → (2) active subscription plan → (3) no plan
  const compPlan = tenant.comp?.planId;
  const subPlan = subscription?.planId;
  const effectivePlan: PlanId | null = compPlan ?? subPlan ?? null;

  // ── Subscription status checks (only if not comped)
  if (!compPlan && subscription) {
    const graceMs = PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (
      subscription.status === 'past_due' &&
      subscription.lastPaymentFailedAt &&
      now > subscription.lastPaymentFailedAt + graceMs
    ) {
      return {
        allowed: false,
        reason: 'payment_past_due_grace_expired',
        currentTier: subscription.planId,
        note: `past_due>${PAYMENT_GRACE_DAYS}d`,
      };
    }
    if (subscription.status === 'unpaid' || subscription.status === 'canceled') {
      return {
        allowed: false,
        reason: 'payment_past_due_grace_expired',
        currentTier: subscription.planId,
      };
    }
    if (
      subscription.status === 'trialing' &&
      subscription.trialEndsAt &&
      now > subscription.trialEndsAt
    ) {
      return {
        allowed: false,
        reason: 'trial_expired',
        currentTier: subscription.planId,
      };
    }
  }

  if (!effectivePlan) {
    return {
      allowed: false,
      reason: 'trial_expired',
      requiredTier: FEATURE_CATALOG[feature].minTier,
      note: 'no_active_plan',
    };
  }

  // ── Operator feature-override — can force specific feature on/off regardless of tier
  const overrideKey = `feature:${feature}`;
  if (tenant.featureOverrides && overrideKey in tenant.featureOverrides) {
    const ov = tenant.featureOverrides[overrideKey];
    if (ov === true) return { allowed: true, note: 'feature_override:on' };
    if (ov === false) {
      return {
        allowed: false,
        reason: 'plan',
        currentTier: effectivePlan,
        requiredTier: FEATURE_CATALOG[feature].minTier,
        note: 'feature_override:off',
      };
    }
  }

  // ── Tier check
  const required = FEATURE_CATALOG[feature].minTier;
  if (!tierMeetsMin(effectivePlan, required)) {
    return {
      allowed: false,
      reason: 'plan',
      currentTier: effectivePlan,
      requiredTier: required,
    };
  }

  // ── Pack check (optional layer)
  //   If a packFlags mapping was supplied AND this feature has a pack key
  //   AND pack flag is explicitly false, deny. Missing keys default allow.
  if (packFlags && feature in packFlags && packFlags[feature] === false) {
    return {
      allowed: false,
      reason: 'pack_off',
      currentTier: effectivePlan,
      note: 'pack_disabled',
    };
  }

  return { allowed: true, currentTier: effectivePlan };
}

// ─────────────────────────────────────────────────────────────────────
// Trial + subscription helpers
// ─────────────────────────────────────────────────────────────────────

/** Milliseconds remaining in the trial; 0 if over; null if not on a trial. */
export function trialMsRemaining(
  sub: Subscription | null,
  now: number = Date.now(),
): number | null {
  if (!sub || sub.status !== 'trialing' || !sub.trialEndsAt) return null;
  return Math.max(0, sub.trialEndsAt - now);
}

export function trialDaysRemaining(
  sub: Subscription | null,
  now: number = Date.now(),
): number | null {
  const ms = trialMsRemaining(sub, now);
  if (ms == null) return null;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** Returns true when the tenant is inside the soft-paywall grace after failed payment. */
export function isInGrace(sub: Subscription | null, now: number = Date.now()): boolean {
  if (!sub || sub.status !== 'past_due' || !sub.lastPaymentFailedAt) return false;
  const graceMs = PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return now <= sub.lastPaymentFailedAt + graceMs;
}

/** Has the tenant hit a specific usage limit? */
export function hasHitLimit(
  plan: PlanId,
  usage: { jobsThisPeriod?: number; activeUsers?: number; aiScansThisPeriod?: number },
): { overLimit: boolean; which?: 'jobs' | 'users' | 'ai' } {
  const p = TIER_CATALOG[plan];
  if (p.maxJobsPerMonth != null && (usage.jobsThisPeriod ?? 0) >= p.maxJobsPerMonth) {
    return { overLimit: true, which: 'jobs' };
  }
  if (p.maxUsers != null && (usage.activeUsers ?? 0) >= p.maxUsers) {
    return { overLimit: true, which: 'users' };
  }
  if (p.maxAiScansPerMonth != null && (usage.aiScansThisPeriod ?? 0) >= p.maxAiScansPerMonth) {
    return { overLimit: true, which: 'ai' };
  }
  return { overLimit: false };
}
