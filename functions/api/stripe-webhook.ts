// ═════════════════════════════════════════════════════════════════════
// /api/stripe-webhook — Receive Stripe events + update Firestore
//
// POST (called by Stripe) → 200 { received: true }
//
// Required env vars:
//   STRIPE_SECRET_KEY      — for verifying / fetching expanded objects
//   STRIPE_WEBHOOK_SECRET  — whsec_xxx (from Stripe webhook config)
//   FIREBASE_SERVICE_ACCOUNT_JSON — full JSON string of service-account credentials
//                                   (used to sign JWT for Firestore REST API)
//
// Setup:
//   1. Create webhook endpoint in Stripe Dashboard → Developers → Webhooks
//      URL: https://your-cf-domain/api/stripe-webhook
//      Events to listen for:
//        • checkout.session.completed
//        • customer.subscription.updated
//        • customer.subscription.deleted
//        • customer.subscription.trial_will_end
//        • invoice.payment_succeeded
//        • invoice.payment_failed
//   2. Copy the signing secret (whsec_xxx) → set STRIPE_WEBHOOK_SECRET
//   3. Generate a Firebase service-account key:
//      Firebase Console → Project Settings → Service Accounts → Generate new private key
//      Paste the JSON contents into FIREBASE_SERVICE_ACCOUNT_JSON
//   4. Push.
//
// PHASE 3 STATUS: signature verification + Firestore writes are TODO.
// Right now this endpoint logs the event and returns 200 so Stripe stops
// retrying, but doesn't yet persist subscription state.
// ═════════════════════════════════════════════════════════════════════

interface Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Don't 500 — Stripe will keep retrying. Log and accept.
    console.warn('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — skipping verification');
  }

  const sig = request.headers.get('stripe-signature') || '';
  const rawBody = await request.text();

  // ── TODO: Verify Stripe signature ──
  // Stripe's standard verification uses HMAC-SHA256. Workers has Web Crypto API.
  // Reference: https://stripe.com/docs/webhooks/signatures
  // const verified = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  // if (!verified) return json(400, { error: 'Invalid signature' });

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  console.log('[stripe-webhook] received event:', event.type);

  // ── Route by event type ──
  // Each handler should be idempotent — Stripe occasionally re-delivers.
  // Guard with a `stripe_events_seen/{event.id}` Firestore doc check.
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      // session.client_reference_id === tenantId (set in checkout creation)
      // session.subscription === Stripe subscription id
      // session.customer === Stripe customer id
      // TODO: write to /tenants/{tid}/subscription/current via Firestore REST API
      console.log('[checkout.session.completed]', session.client_reference_id, session.subscription);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object;
      // TODO: write planId, status, periodEnd, etc. to subscription doc
      console.log('[subscription.updated]', sub.id, sub.status);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      // TODO: mark subscription canceled, set tenant.status = 'canceled'
      console.log('[subscription.deleted]', sub.id);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      // TODO: increment failure count, set tenant.status = 'past_due',
      //       send our branded "card failed" email via Resend
      console.log('[invoice.payment_failed]', invoice.subscription);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      // TODO: clear past_due state if set, send receipt email
      console.log('[invoice.payment_succeeded]', invoice.subscription);
      break;
    }
    case 'customer.subscription.trial_will_end': {
      const sub = event.data.object;
      // TODO: send "trial ending in 3 days" email
      console.log('[trial_will_end]', sub.id);
      break;
    }
    default:
      // Unhandled event types are fine — Stripe sends many; we only act on the ones above.
      console.log('[stripe-webhook] unhandled event type:', event.type);
  }

  return json(200, { received: true });
};
