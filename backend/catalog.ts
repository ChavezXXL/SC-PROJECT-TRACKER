// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — Tier Catalog & Feature Catalog
//
// Single source of truth for:
//   • Which features exist
//   • Which tier unlocks each feature
//   • What each tier costs
//   • What limits apply
//
// When you want to change pricing or gating, edit THIS file. Everything
// else — the pricing page, the feature gate, the upgrade nudge — reads
// from these constants.
// ═════════════════════════════════════════════════════════════════════

import type {
  PlanDefinition,
  PlanId,
  FeatureDefinition,
  TierFeatureKey,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// TIER CATALOG — pricing, limits, unlocked features per plan
// ─────────────────────────────────────────────────────────────────────

export const TIER_CATALOG: Record<PlanId, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'Solo shops getting out of spreadsheets.',
    priceMonthly: 49,
    priceAnnualMonthly: 39,
    maxUsers: 1,
    maxJobsPerMonth: 100,
    maxWorkflowStages: 5,
    trialDays: 14,
    support: 'Email · 48h reply',
    features: [
      'jobs',
      'quotes',
      'shopFlowMap',
      'customerPortal',
      'basicReports',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'Growing shops running a real floor.',
    priceMonthly: 149,
    priceAnnualMonthly: 119,
    maxUsers: 10,
    maxJobsPerMonth: null,
    maxWorkflowStages: null,
    trialDays: 14,
    mostPopular: true,
    support: 'Email · 24h reply',
    features: [
      // Core
      'jobs',
      'quotes',
      'shopFlowMap',
      'customerPortal',
      'basicReports',
      // Pro unlocks
      'kanbanBoard',
      'liveFloorTv',
      'tvSlideshow',
      'perCustomerRouting',
      'customWorkflowStages',
      'purchaseOrders',
      'vendorDatabase',
      'deliveries',
      'samples',
      'shiftAlarms',
      'workerBadges',
      'googleCalendar',
    ],
  },
  fabtrack_io: {
    id: 'fabtrack_io',
    name: 'FabTrack IO',
    tagline: 'Full shop suite with AI, quality, and financials.',
    priceMonthly: 349,
    priceAnnualMonthly: 279,
    maxUsers: null,
    maxJobsPerMonth: null,
    maxWorkflowStages: null,
    maxAiScansPerMonth: 500,
    trialDays: 14,
    support: 'Phone + Slack · 4h reply',
    features: [
      // Core
      'jobs',
      'quotes',
      'shopFlowMap',
      'customerPortal',
      'basicReports',
      // Pro
      'kanbanBoard',
      'liveFloorTv',
      'tvSlideshow',
      'perCustomerRouting',
      'customWorkflowStages',
      'purchaseOrders',
      'vendorDatabase',
      'deliveries',
      'samples',
      'shiftAlarms',
      'workerBadges',
      'googleCalendar',
      // FabTrack IO unlocks
      'quality',
      'financialReports',
      'aiScanning',
      'advancedReporting',
      'apiAccess',
      'sso',
      'customDomain',
      'prioritySupport',
    ],
  },
};

/** Ordered list — useful for iterating in pricing cards. */
export const TIER_ORDER: PlanId[] = ['starter', 'pro', 'fabtrack_io'];

/** Numeric rank — used by `isFeatureEnabled` to compare "do you have >= the required tier?". */
export const TIER_RANK: Record<PlanId, number> = {
  starter: 1,
  pro: 2,
  fabtrack_io: 3,
};

// ─────────────────────────────────────────────────────────────────────
// FEATURE CATALOG — what each feature is, which tier unlocks it
// ─────────────────────────────────────────────────────────────────────

export const FEATURE_CATALOG: Record<TierFeatureKey, FeatureDefinition> = {
  // Core — every paid tier
  jobs: {
    key: 'jobs',
    label: 'Jobs',
    minTier: 'starter',
    category: 'core',
    description: 'Track jobs from received to delivered.',
  },
  quotes: {
    key: 'quotes',
    label: 'Quote builder',
    minTier: 'starter',
    category: 'core',
    description: 'Build and send quotes; track customer engagement.',
  },
  shopFlowMap: {
    key: 'shopFlowMap',
    label: 'Shop Flow Map',
    minTier: 'starter',
    category: 'core',
    description: 'Live stage-by-stage view of every open job.',
  },
  customerPortal: {
    key: 'customerPortal',
    label: 'Customer portal',
    minTier: 'starter',
    category: 'core',
    description: 'Share a link; customers see their own jobs and status.',
  },
  basicReports: {
    key: 'basicReports',
    label: 'Basic reports',
    minTier: 'starter',
    category: 'core',
    description: 'On-time rate, open job count, weekly summary.',
  },

  // Pro unlocks
  kanbanBoard: {
    key: 'kanbanBoard',
    label: 'Kanban board',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Drag-and-drop job tiles across stages.',
    upgradeBlurb: 'The Kanban board lives on Pro and above.',
  },
  liveFloorTv: {
    key: 'liveFloorTv',
    label: 'Live Floor TV',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Shop-floor TV mode with live worker activity.',
    upgradeBlurb: 'TV mode is a Pro feature.',
  },
  tvSlideshow: {
    key: 'tvSlideshow',
    label: 'TV slideshow',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Rotating TV slides — goals, safety messages, leaderboard.',
  },
  perCustomerRouting: {
    key: 'perCustomerRouting',
    label: 'Per-customer routing',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Skip stages for specific customers (e.g. "Boeing skips Stamp").',
    upgradeBlurb: 'Per-customer workflows are Pro+.',
  },
  customWorkflowStages: {
    key: 'customWorkflowStages',
    label: 'Unlimited workflow stages',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Starter caps at 5; Pro+ is unlimited.',
    upgradeBlurb: 'Starter is capped at 5 stages. Upgrade to add more.',
  },
  purchaseOrders: {
    key: 'purchaseOrders',
    label: 'Purchase Orders',
    minTier: 'pro',
    category: 'commerce',
    description: 'Enterprise-grade outbound PO builder with quality reqs, per-line drawings.',
    upgradeBlurb: 'Purchase Orders are a Pro+ feature.',
  },
  vendorDatabase: {
    key: 'vendorDatabase',
    label: 'Vendor database',
    minTier: 'pro',
    category: 'commerce',
    description: 'Track vendors, categories, payment terms, approval flow.',
  },
  deliveries: {
    key: 'deliveries',
    label: 'GPS deliveries',
    minTier: 'pro',
    category: 'logistics',
    description: 'Track driver runs, GPS mileage, IRS export.',
    upgradeBlurb: 'Delivery tracking is part of Pro.',
  },
  samples: {
    key: 'samples',
    label: 'Samples library',
    minTier: 'pro',
    category: 'commerce',
    description: 'One-off test work tracking separate from production jobs.',
    upgradeBlurb: 'The samples library is Pro+.',
  },
  shiftAlarms: {
    key: 'shiftAlarms',
    label: 'Shift alarms',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Configurable alarms for lunch, breaks, shift end.',
  },
  workerBadges: {
    key: 'workerBadges',
    label: 'Worker QR badges',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Print QR code badges for floor clock-in.',
  },
  googleCalendar: {
    key: 'googleCalendar',
    label: 'Google Calendar sync',
    minTier: 'pro',
    category: 'shop-floor',
    description: 'Push jobs with due dates into Google Calendar.',
  },

  // FabTrack IO unlocks
  quality: {
    key: 'quality',
    label: 'Quality / Rework tracking',
    minTier: 'fabtrack_io',
    category: 'quality',
    description: 'Rework log with reason codes, resolution notes, trend reporting.',
    upgradeBlurb: 'Quality tracking is on the FabTrack IO plan.',
  },
  financialReports: {
    key: 'financialReports',
    label: 'Financial reports',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'Revenue, cost-per-job, profit-margin, overhead allocation.',
    upgradeBlurb: 'Financial reporting is on the FabTrack IO plan.',
  },
  aiScanning: {
    key: 'aiScanning',
    label: 'AI PO scanner',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'Drop a PO PDF → AI pulls fields. 500 scans/month included.',
    upgradeBlurb: 'AI scanning unlocks on FabTrack IO.',
  },
  advancedReporting: {
    key: 'advancedReporting',
    label: 'Advanced reporting',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'Custom report builder, scheduled exports.',
  },
  apiAccess: {
    key: 'apiAccess',
    label: 'API access',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'REST API for ERP / ERP-adjacent integrations.',
  },
  sso: {
    key: 'sso',
    label: 'SSO (Google / SAML)',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'Single sign-on for larger teams.',
  },
  customDomain: {
    key: 'customDomain',
    label: 'Custom portal domain',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'Customer portals on your own domain (tracker.yourshop.com).',
  },
  prioritySupport: {
    key: 'prioritySupport',
    label: 'Priority support',
    minTier: 'fabtrack_io',
    category: 'advanced',
    description: 'Phone + Slack support, 4-hour reply.',
  },
};

// ─────────────────────────────────────────────────────────────────────
// Helpers — keep callers decoupled from the constants' shape
// ─────────────────────────────────────────────────────────────────────

/** Return the PlanDefinition for a plan id. */
export function getPlan(planId: PlanId): PlanDefinition {
  return TIER_CATALOG[planId];
}

/** Return all features unlocked at `planId`. */
export function featuresForPlan(planId: PlanId): TierFeatureKey[] {
  return TIER_CATALOG[planId].features;
}

/** Does `planId` unlock `feature`? */
export function planHasFeature(planId: PlanId, feature: TierFeatureKey): boolean {
  return TIER_CATALOG[planId].features.includes(feature);
}

/** Return the lowest plan that includes `feature`. */
export function minPlanFor(feature: TierFeatureKey): PlanId {
  return FEATURE_CATALOG[feature].minTier;
}

/** Is `currentPlan` at least `minPlan` in the tier hierarchy? */
export function tierMeetsMin(currentPlan: PlanId, minPlan: PlanId): boolean {
  return TIER_RANK[currentPlan] >= TIER_RANK[minPlan];
}
