// ═════════════════════════════════════════════════════════════════════
// /api/stripe-session-verify — Fetch a completed Checkout Session
//
// GET ?session_id=cs_xxx
//   → 200 { planId, interval, status, stripeCustomerId, stripeSubscriptionId,
//           stripePriceId, currentPeriodEnd }
//   → 4xx/5xx { error }
//
// Called by /billing/success after Stripe redirects the customer back.
// Returns enough info for the client to write subscription state to
// Firestore. Webhook does the same thing as belt-and-suspenders later.
// ═════════════════════════════════════════════════════════════════════

interface Env {
  STRIPE_SECRET_KEY?: string;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Map a Stripe price id back to our internal PlanId.
 *  Reads the same env vars the checkout endpoint uses. */
function planIdForPrice(env: Env, priceId: string | undefined): { planId: string; interval: 'month' | 'year' } | null {
  if (!priceId) return null;
  const e = env as any;
  if (priceId === e.STRIPE_PRICE_STARTER_M) return { planId: 'starter', interval: 'month' };
  if (priceId === e.STRIPE_PRICE_STARTER_Y) return { planId: 'starter', interval: 'year' };
  if (priceId === e.STRIPE_PRICE_PRO_M)     return { planId: 'pro',     interval: 'month' };
  if (priceId === e.STRIPE_PRICE_PRO_Y)     return { planId: 'pro',     interval: 'year' };
  if (priceId === e.STRIPE_PRICE_FAB_M)     return { planId: 'fabtrack_io', interval: 'month' };
  if (priceId === e.STRIPE_PRICE_FAB_Y)     return { planId: 'fabtrack_io', interval: 'year' };
  return null;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!env.STRIPE_SECRET_KEY) {
    return json(501, { error: 'STRIPE_SECRET_KEY not set on the server.' });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) return json(400, { error: 'Missing session_id' });

  try {
    // Fetch the session WITH the subscription expanded so we get prices + period dates
    const params = new URLSearchParams();
    params.append('expand[]', 'subscription');
    params.append('expand[]', 'subscription.items.data.price');

    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } },
    );
    const data: any = await res.json();
    if (!res.ok) {
      return json(res.status, { error: data?.error?.message || 'Stripe error' });
    }

    if (data.payment_status !== 'paid' && data.status !== 'complete') {
      return json(409, { error: `Session not yet completed (status: ${data.status})` });
    }

    const sub = data.subscription;
    if (!sub || typeof sub !== 'object') {
      return json(500, { error: 'Subscription not present on session' });
    }

    const priceId: string | undefined = sub.items?.data?.[0]?.price?.id;
    const mapping = planIdForPrice(env, priceId);
    if (!mapping) {
      return json(500, {
        error: `Unknown price id (${priceId}) — make sure STRIPE_PRICE_* env vars are set correctly.`,
      });
    }

    return json(200, {
      planId: mapping.planId,
      interval: mapping.interval,
      status: sub.status,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      currentPeriodEnd: sub.current_period_end,
      currentPeriodStart: sub.current_period_start,
    });
  } catch (e: any) {
    return json(500, { error: e?.message || 'Unexpected error' });
  }
};
