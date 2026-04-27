// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — Billing Service (STUBS — Phase 3)
//
// Handles everything Stripe-related:
//   • Checkout session creation
//   • Customer Portal link (self-serve billing)
//   • Webhook event handling (payment succeeded/failed, plan changed)
//   • Subscription state → Firestore sync
//   • Trial countdown + dunning state tracking
//
// Every exported function here is a typed stub. The implementation lands
// in Phase 3. See BACKEND_PLAN.md for sequencing.
//
// IMPORTANT: Stripe webhook processing MUST happen server-side in a
// Netlify Function (`netlify/functions/stripe-webhook.ts`) — never in
// the browser — because webhook secrets must stay server-only and we
// have to verify the signed payload.
// ═════════════════════════════════════════════════════════════════════

import type {
  PlanId,
  Subscription,
  SubscriptionStatus,
  Tenant,
} from './types';

// ─────────────────────────────────────────────────────────────────────
// Checkout — kick user to Stripe-hosted checkout page
// ─────────────────────────────────────────────────────────────────────

export interface CheckoutInput {
  tenantId: string;
  planId: PlanId;
  interval: 'month' | 'year';
  /** Return URL after success. Usually `/billing/success?session_id=…`. */
  successUrl: string;
  cancelUrl: string;
  /** Account email for prefill. */
  email: string;
  /** Existing Stripe Customer id, if tenant already has one (upgrade flow). */
  stripeCustomerId?: string;
}

export interface CheckoutResult {
  sessionId: string;
  /** Stripe-hosted URL the client redirects to. */
  url: string;
}

export async function createCheckoutSession(_input: CheckoutInput): Promise<CheckoutResult> {
  throw new Error('createCheckoutSession() not wired yet — Phase 3');
}

// ─────────────────────────────────────────────────────────────────────
// Customer Portal — self-serve cancel, update card, invoice history
// ─────────────────────────────────────────────────────────────────────

export async function createCustomerPortalLink(
  _stripeCustomerId: string,
  _returnUrl: string,
): Promise<{ url: string }> {
  throw new Error('createCustomerPortalLink() not wired yet — Phase 3');
}

// ─────────────────────────────────────────────────────────────────────
// Webhook events (server-side only)
// ─────────────────────────────────────────────────────────────────────

/** Stripe sends these events; we persist the outcome to Firestore. */
export type StripeWebhookEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'customer.subscription.trial_will_end'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'
  | 'invoice.upcoming'
  | 'payment_method.attached'
  | 'payment_method.detached';

export interface WebhookResult {
  handled: boolean;
  action?: 'subscription_upserted' | 'subscription_canceled' | 'payment_failed_recorded' | 'trial_ending_warned';
  tenantId?: string;
  note?: string;
}

/**
 * Top-level webhook handler. Called from `netlify/functions/stripe-webhook.ts`
 * after signature verification. Never call this from the browser.
 */
export async function handleStripeWebhook(_event: {
  type: StripeWebhookEventType;
  data: { object: unknown };
}): Promise<WebhookResult> {
  throw new Error('handleStripeWebhook() not wired yet — Phase 3');
}

// ─────────────────────────────────────────────────────────────────────
// Stripe → Firestore sync shape
// ─────────────────────────────────────────────────────────────────────

/** Convert Stripe's subscription object to our internal `Subscription` shape.
 *  Kept here so the webhook handler, the manual-sync tool, and the admin
 *  "force sync" action all use the same normalization. */
export function normalizeStripeSubscription(_stripeSub: unknown): Subscription {
  throw new Error('normalizeStripeSubscription() not wired yet — Phase 3');
}

/** Bridge Stripe statuses to our `SubscriptionStatus` enum — most are 1:1. */
export function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':           return 'trialing';
    case 'active':             return 'active';
    case 'past_due':           return 'past_due';
    case 'unpaid':             return 'unpaid';
    case 'canceled':           return 'canceled';
    case 'incomplete':         return 'incomplete';
    case 'incomplete_expired': return 'incomplete_expired';
    case 'paused':             return 'paused';
    default:                   return 'incomplete';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Dunning (failed-payment cadence)
// ─────────────────────────────────────────────────────────────────────

/**
 * Stripe's built-in "Smart Retries" handles 90% of failed-payment recovery:
 *   • Retries a failed card up to 4 times over ~3 weeks.
 *   • Sends Stripe-branded emails on each attempt (if enabled).
 *   • On final failure, emits `customer.subscription.updated` with
 *     status=unpaid, which we catch in `handleStripeWebhook`.
 *
 * What WE do on top of Stripe's built-in emails:
 *   1. On `invoice.payment_failed`: set tenant.status = 'past_due',
 *      mark `subscription.lastPaymentFailedAt`, count attempts.
 *   2. Send our own "Card failed" email via Resend with our branding.
 *   3. Show an in-app banner: "We couldn't charge your card — update
 *      payment method". Links to Stripe Customer Portal.
 *   4. Grace window: PAYMENT_GRACE_DAYS (3) of full access.
 *   5. After grace: soft paywall on write actions, read still works.
 *   6. On PAUSE_THRESHOLD_DAYS (30): set tenant.status = 'paused',
 *      refuse login except to /billing.
 *
 * Nothing in this function runs server-side automatically — it's called
 * from the webhook handler when the right event arrives.
 */
export interface DunningStateTransition {
  tenantId: string;
  from: SubscriptionStatus;
  to: SubscriptionStatus;
  shouldEmail: boolean;
  emailTemplate?: 'card-failed-initial' | 'card-failed-final' | 'trial-ending' | 'paused';
  updatedFields: Partial<Subscription>;
  updatedTenantFields: Partial<Pick<Tenant, 'status' | 'statusReason' | 'statusUpdatedAt'>>;
}

export function computeDunningTransition(
  _currentSub: Subscription,
  _event: { type: StripeWebhookEventType; data: unknown },
): DunningStateTransition | null {
  throw new Error('computeDunningTransition() not wired yet — Phase 3');
}

// ─────────────────────────────────────────────────────────────────────
// Outbound transactional emails (Resend / Postmark)
// ─────────────────────────────────────────────────────────────────────

/** List of every transactional email the system sends. Keep this the source
 *  of truth — one template per name. */
export type TransactionalEmailTemplate =
  | 'welcome'                    // sent right after signup
  | 'email-verify'               // verification link
  | 'password-reset'
  | 'trial-ending-3d'            // 3 days before trial ends
  | 'trial-ending-1d'            // 1 day before
  | 'trial-ended'                // at expiry
  | 'card-failed-initial'        // first failed charge
  | 'card-failed-final'          // retries exhausted
  | 'subscription-canceled'      // customer canceled
  | 'subscription-reactivated'
  | 'paused-account'             // 30-day unpaid
  | 'invite-received'            // teammate invite
  | 'invoice-receipt';           // on successful charge

export interface EmailInput {
  template: TransactionalEmailTemplate;
  to: string;
  tenantId?: string;
  /** Template variables for interpolation. */
  vars?: Record<string, string | number | boolean>;
}

export async function sendTransactionalEmail(_input: EmailInput): Promise<{ id: string }> {
  throw new Error('sendTransactionalEmail() not wired yet — needs Resend/Postmark integration in Phase 3');
}

/** Which emails does Stripe send automatically (we don't need to duplicate)?
 *  Set these as "Enabled" in Stripe Dashboard → Settings → Customer Emails:
 *    • Invoice payment failed
 *    • Invoice paid
 *    • Trial ending (if enabled in subscription config)
 *    • Subscription canceled
 *    • Upcoming invoice (7 days before renewal)
 *  OUR emails supplement these with more context + branding. */
export const STRIPE_HANDLES_NATIVELY: TransactionalEmailTemplate[] = [
  'invoice-receipt',
  // Stripe also sends "upcoming invoice" and generic "payment failed" but we
  // override with branded versions above.
];
