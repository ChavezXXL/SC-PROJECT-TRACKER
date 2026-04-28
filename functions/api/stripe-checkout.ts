/// <reference types="@cloudflare/workers-types" />
// ═════════════════════════════════════════════════════════════════════
// /api/stripe-checkout — Create a Stripe Checkout Session
//
// POST { tenantId, planId, interval, successUrl, cancelUrl, email, customerId? }
//   → 200 { url } — redirect the browser to this URL
//   → 4xx/5xx — { error } — surface to user
//
// Required env vars (set via wrangler pages secret put):
//   STRIPE_SECRET_KEY       — sk_live_xxx or sk_test_xxx
//   STRIPE_PRICE_STARTER_M  — price_xxx (Starter monthly)
//   STRIPE_PRICE_STARTER_Y  — price_xxx (Starter annual)
//   STRIPE_PRICE_PRO_M      — price_xxx
//   STRIPE_PRICE_PRO_Y      — price_xxx
//   STRIPE_PRICE_FAB_M      — price_xxx (FabTrack IO monthly)
//   STRIPE_PRICE_FAB_Y      — price_xxx
//
// First-time setup:
//   1. Create products + prices in Stripe (see backend/STRIPE_SETUP.md)
//   2. Set the env vars above
//   3. Push — Cloudflare auto-deploys this function
// ═════════════════════════════════════════════════════════════════════

interface Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_STARTER_M?: string;
  STRIPE_PRICE_STARTER_Y?: string;
  STRIPE_PRICE_PRO_M?: string;
  STRIPE_PRICE_PRO_Y?: string;
  STRIPE_PRICE_FAB_M?: string;
  STRIPE_PRICE_FAB_Y?: string;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

type PlanId = 'starter' | 'pro' | 'fabtrack_io';
type Interval = 'month' | 'year';

interface CheckoutInput {
  tenantId: string;
  planId: PlanId;
  interval: Interval;
  successUrl: string;
  cancelUrl: string;
  email: string;
  customerId?: string;        // existing Stripe customer (if upgrading)
}

function priceIdFor(env: Env, plan: PlanId, interval: Interval): string | undefined {
  const map: Record<string, keyof Env> = {
    'starter:month':     'STRIPE_PRICE_STARTER_M',
    'starter:year':      'STRIPE_PRICE_STARTER_Y',
    'pro:month':         'STRIPE_PRICE_PRO_M',
    'pro:year':          'STRIPE_PRICE_PRO_Y',
    'fabtrack_io:month': 'STRIPE_PRICE_FAB_M',
    'fabtrack_io:year':  'STRIPE_PRICE_FAB_Y',
  };
  const key = map[`${plan}:${interval}`];
  return key ? (env[key] as string | undefined) : undefined;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return json(501, {
      error: 'Stripe not configured. Owner: set STRIPE_SECRET_KEY + the 6 STRIPE_PRICE_* vars in Cloudflare → Pages → Settings → Environment Variables. See backend/STRIPE_SETUP.md.',
      code: 'NOT_CONFIGURED',
    });
  }

  let body: CheckoutInput;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { tenantId, planId, interval, successUrl, cancelUrl, email, customerId } = body;
  if (!tenantId || !planId || !interval || !successUrl || !cancelUrl || !email) {
    return json(400, { error: 'Missing required fields: tenantId, planId, interval, successUrl, cancelUrl, email' });
  }

  const priceId = priceIdFor(env, planId, interval);
  if (!priceId) {
    return json(400, {
      error: `No Stripe price configured for ${planId}/${interval}. Set STRIPE_PRICE_${planId.toUpperCase()}_${interval === 'month' ? 'M' : 'Y'} env var.`,
      code: 'PRICE_MISSING',
    });
  }

  // Build Stripe Checkout Session via REST API (no SDK needed on Workers).
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('client_reference_id', tenantId);
  params.set('subscription_data[metadata][tenantId]', tenantId);
  params.set('subscription_data[metadata][planId]', planId);
  if (customerId) {
    params.set('customer', customerId);
  } else {
    params.set('customer_email', email);
  }
  params.set('allow_promotion_codes', 'true');
  params.set('billing_address_collection', 'required');

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('[stripe-checkout] error', data);
      return json(res.status, { error: data?.error?.message || 'Stripe error' });
    }
    return json(200, { url: data.url, sessionId: data.id });
  } catch (e: any) {
    console.warn('[stripe-checkout] threw', e);
    return json(500, { error: e?.message || 'Internal error' });
  }
};
