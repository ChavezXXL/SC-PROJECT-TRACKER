// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — SaaS Backend Types
//
// Source of truth for tenant, identity, billing, and feature-gate shapes.
// Nothing in this file is wired into the live app yet.
// ═════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// IDENTITY
// ─────────────────────────────────────────────────────────────────────

/** Roles a member can have inside a tenant. */
export type TenantMemberRole =
  | 'owner'      // billing + all admin, only 1 per tenant
  | 'admin'      // everything except billing, multiple allowed
  | 'manager'    // create/edit jobs, quotes, POs; cannot invite or edit settings
  | 'viewer';    // read-only

/** A Firebase Auth user — one per email. Can belong to multiple tenants. */
export interface Account {
  uid: string;                    // Firebase Auth UID
  email: string;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  /** Tenants this account is a member of. Mirrors `tenants/{tid}/members/{uid}` for quick lookup. */
  tenantIds: string[];
  /** Which tenant to open by default on login. */
  defaultTenantId?: string;
  /** God-mode bit for the operator (us). Checked in security rules AND in the UI.
   *  When true, the account can read/write any tenant + see the admin console.
   *  Set manually in Firestore — NEVER settable from the client. */
  superAdmin?: boolean;
  /** Set to true to refuse logins globally. Overrides any tenant membership. */
  banned?: boolean;
  banReason?: string;
  bannedAt?: number;
  createdAt: number;
  lastLoginAt?: number;
}

/** A member of a tenant — the join row between account and tenant. */
export interface TenantMember {
  uid: string;                    // Account UID
  tenantId: string;
  role: TenantMemberRole;
  email: string;
  name?: string;
  /** Pending invite vs. active membership. */
  status: 'invited' | 'active' | 'suspended';
  invitedAt?: number;
  invitedByUid?: string;
  joinedAt?: number;
  lastSeenAt?: number;
}

// ─────────────────────────────────────────────────────────────────────
// TENANT (a customer of ours — one shop, one Firestore subtree)
// ─────────────────────────────────────────────────────────────────────

/** Lifecycle of a tenant — what state the shop is in overall. */
export type TenantStatus =
  | 'trialing'    // new signup, 14-day trial running
  | 'active'     // paid subscription in good standing
  | 'past_due'   // payment failed, in grace window (3 days)
  | 'unpaid'     // grace expired, read-only mode, soft paywall
  | 'paused'     // 30+ days unpaid, logins blocked except to billing page
  | 'suspended'  // operator-banned (fraud, chargeback, TOS violation)
  | 'canceled';  // customer-initiated cancellation, data retained 90 days then purged

export interface Tenant {
  id: string;                    // slug-safe, e.g. "acme-machining" or "sc_deburring"
  name: string;                  // "Acme Machining" — display name
  slug: string;                  // URL-safe alias, used for portal URLs
  ownerUid: string;              // current owning account
  billingEmail?: string;         // invoices + dunning emails go here
  timezone?: string;             // e.g. "America/Los_Angeles"
  logo?: string;                 // optional logo URL
  createdAt: number;
  status: TenantStatus;
  /** Overall account health — set by operator or payment webhook. */
  statusReason?: string;
  statusUpdatedAt?: number;
  /** When true, the tenant predates multi-tenant paths. Collection reads/writes
   *  go to flat paths (`jobs`, `logs`, etc.) instead of `tenants/{id}/jobs/...`.
   *  Used to keep the SC Deburring install running without data migration. */
  isLegacy?: boolean;
  /** Optional override: manually enable features regardless of tier.
   *  Used by ops to comp specific shops without changing their subscription. */
  featureOverrides?: Partial<Record<string, boolean>>;
  /** Set by ops to pin a tenant to a specific plan without Stripe (comps, internal). */
  comp?: { planId: PlanId; reason: string; setByUid: string; setAt: number };
}

// ─────────────────────────────────────────────────────────────────────
// BILLING
// ─────────────────────────────────────────────────────────────────────

export type PlanId = 'starter' | 'pro' | 'fabtrack_io';

export type BillingInterval = 'month' | 'year';

/** What Stripe tells us about the subscription. Mirrors Stripe's own states. */
export type SubscriptionStatus =
  | 'trialing'         // new, not yet paid, within trial window
  | 'active'           // paying on time
  | 'past_due'         // last invoice failed, Stripe retrying
  | 'unpaid'           // retries exhausted
  | 'canceled'         // fully canceled (no more billing)
  | 'incomplete'       // signup started but payment method not yet attached
  | 'incomplete_expired'
  | 'paused';          // manually paused by us

export interface Subscription {
  tenantId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  interval: BillingInterval;
  seats: number;                 // billable seats (= active members count, roughly)
  /** Trial tracking. */
  trialStartedAt?: number;
  trialEndsAt?: number;          // ms — used for banner countdown + soft paywall
  /** Current billing period bounds — from Stripe. */
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  /** When true, will not auto-renew at period end. */
  cancelAtPeriodEnd?: boolean;
  canceledAt?: number;
  /** Stripe identifiers — set by webhook. Never set from client. */
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  /** Dunning state — tracked for email cadence + UI warnings. */
  lastPaymentFailedAt?: number;
  paymentFailedCount?: number;
  lastInvoiceUrl?: string;       // Stripe-hosted invoice link for one-click pay
  updatedAt: number;
}

/** A single row in the `TIER_CATALOG`. Drives pricing, Stripe mapping, and gating. */
export interface PlanDefinition {
  id: PlanId;
  name: string;                  // "Starter"
  tagline: string;               // one-liner for pricing cards
  priceMonthly: number;          // USD, integer dollars
  priceAnnualMonthly: number;    // USD effective monthly when billed annually
  /** Filled once Stripe products/prices are created. */
  stripePriceMonthly?: string;   // Stripe price ID (price_xxx)
  stripePriceAnnual?: string;
  /** Limits — null = unlimited. */
  maxUsers: number | null;
  maxJobsPerMonth: number | null;
  maxWorkflowStages: number | null;
  maxAiScansPerMonth?: number | null;
  trialDays: number;
  /** Which tier-gated features are unlocked. Drives the feature-gate check. */
  features: TierFeatureKey[];
  /** Short human description of support tier for pricing card. */
  support: string;
  mostPopular?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// FEATURE FLAGS (tier-gated)
// ─────────────────────────────────────────────────────────────────────

/** All features the gate knows about. Add new keys here and to `FEATURE_CATALOG`. */
export type TierFeatureKey =
  // Core (every tier)
  | 'jobs'
  | 'quotes'
  | 'shopFlowMap'
  | 'customerPortal'
  | 'basicReports'
  // Pro tier unlocks
  | 'kanbanBoard'
  | 'liveFloorTv'
  | 'tvSlideshow'
  | 'perCustomerRouting'
  | 'customWorkflowStages'        // unlimited stages (starter caps at 5)
  | 'purchaseOrders'
  | 'vendorDatabase'
  | 'deliveries'
  | 'samples'
  | 'shiftAlarms'
  | 'workerBadges'
  | 'googleCalendar'
  // FabTrack IO tier unlocks
  | 'quality'                    // rework log, NCR module
  | 'financialReports'           // profit/loss, job cost reports
  | 'aiScanning'                 // AI PO scanner (Gemini)
  | 'advancedReporting'
  | 'apiAccess'
  | 'sso'
  | 'customDomain'
  | 'prioritySupport';

/** Metadata for each feature — label, category, gating tier, upgrade copy. */
export interface FeatureDefinition {
  key: TierFeatureKey;
  label: string;                  // "Purchase Orders"
  minTier: PlanId;                // "pro" | "fabtrack_io" | "starter"
  category: 'core' | 'shop-floor' | 'commerce' | 'logistics' | 'quality' | 'advanced';
  description: string;            // one-line for docs/tooltips
  /** Copy shown in the upgrade nudge. */
  upgradeBlurb?: string;
  /** Deep-link inside the app to take users to after upgrade. */
  returnTo?: string;
}

// ─────────────────────────────────────────────────────────────────────
// USAGE (for limits + billing)
// ─────────────────────────────────────────────────────────────────────

/** Per-period usage counters, capped to tier limits. */
export interface TenantUsage {
  tenantId: string;
  periodStart: number;
  periodEnd: number;
  jobsCreated: number;
  activeUsers: number;
  aiScansUsed: number;
  /** Set when any counter exceeds plan limit; drives UI warnings. */
  overLimit: boolean;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────
// INVITES
// ─────────────────────────────────────────────────────────────────────

export interface Invite {
  id: string;
  tenantId: string;
  email: string;
  role: TenantMemberRole;
  token: string;                  // random URL token
  expiresAt: number;              // ms; default createdAt + 7d
  createdBy: string;              // inviting member UID
  createdAt: number;
  /** Status lifecycle. */
  acceptedAt?: number;
  acceptedByUid?: string;
  revokedAt?: number;
  revokedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────
// AUDIT + OPERATOR ACTIONS
// ─────────────────────────────────────────────────────────────────────

/** Logged whenever a super-admin (us) takes a privileged action. */
export interface OperatorAuditEntry {
  id: string;
  operatorUid: string;
  operatorEmail: string;
  action:
    | 'tenant.suspend'
    | 'tenant.unsuspend'
    | 'tenant.comp_plan_set'
    | 'tenant.comp_plan_clear'
    | 'account.ban'
    | 'account.unban'
    | 'account.impersonate_start'
    | 'account.impersonate_end'
    | 'feature_override.set'
    | 'feature_override.clear'
    | 'invoice.force_mark_paid'
    | 'data.export'
    | 'data.purge';
  targetTenantId?: string;
  targetUid?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  at: number;
}
