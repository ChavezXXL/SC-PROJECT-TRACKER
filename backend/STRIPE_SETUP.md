# Stripe Setup — One-time Owner Steps

> **Status:** Endpoint scaffolds shipped. Stripe account setup and env-var
> wiring still need to happen before billing actually works.
>
> Plan IDs match `backend/catalog.ts`:
> `starter` ($49/mo, $39 annual) · `pro` ($149/mo, $119 annual) · `fabtrack_io` ($349/mo, $279 annual)

---

## 1. Create your Stripe account (5 min)

1. Sign up at https://dashboard.stripe.com (use your business email — you can change later)
2. Activate your account: business details, bank account, tax ID
3. Toggle **Test mode** in the top-right (use test mode for the entire setup; switch to live only after end-to-end test)

## 2. Create products + prices (10 min)

In Stripe Dashboard → Products → **+ Add product**, create THREE products with TWO prices each:

### Starter
- Name: `FabTrack IO — Starter`
- Description: `Solo shops getting out of spreadsheets.`
- Prices:
  - **Recurring monthly** — $49.00 USD
  - **Recurring yearly** — $468.00 USD ($39/mo effective)

### Pro
- Name: `FabTrack IO — Pro`
- Description: `Growing shops running a real floor.`
- Prices:
  - **Recurring monthly** — $149.00 USD
  - **Recurring yearly** — $1,428.00 USD ($119/mo effective)

### FabTrack IO
- Name: `FabTrack IO — Full Suite`
- Description: `Full shop suite with quality, financials, advanced reports.`
- Prices:
  - **Recurring monthly** — $349.00 USD
  - **Recurring yearly** — $3,348.00 USD ($279/mo effective)

After creating each price, **copy the price ID** (looks like `price_1Q...`) — you'll paste these into Cloudflare in Step 4.

## 3. Configure the webhook endpoint (3 min)

Stripe Dashboard → Developers → **Webhooks** → **Add endpoint**

- **Endpoint URL:** `https://sc-project-tracker.pages.dev/api/stripe-webhook` (use your final domain when you cut DNS)
- **Events to send** — select these 6:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- **API version** — leave default
- Click **Add endpoint**

After it's created, click **Reveal signing secret** — it's `whsec_...`. Copy it.

Also recommended: enable **Smart Retries** (Settings → Subscriptions → toggle on) so Stripe retries failed cards automatically.

## 4. Set Cloudflare env vars (2 min)

Cloudflare Dashboard → Workers & Pages → `sc-project-tracker` → **Settings → Environment Variables → Production** → add these as **Encrypted (Secret)**:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` (from Stripe → Developers → API keys → Secret key) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (from Step 3) |
| `STRIPE_PRICE_STARTER_M` | price_id from Starter monthly |
| `STRIPE_PRICE_STARTER_Y` | price_id from Starter annual |
| `STRIPE_PRICE_PRO_M` | price_id from Pro monthly |
| `STRIPE_PRICE_PRO_Y` | price_id from Pro annual |
| `STRIPE_PRICE_FAB_M` | price_id from FabTrack IO monthly |
| `STRIPE_PRICE_FAB_Y` | price_id from FabTrack IO annual |

Plus for the webhook to write to Firestore (Phase 3 implementation):

| Variable | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full JSON contents from Firebase → Project Settings → Service Accounts → Generate new private key |

After saving, **trigger a fresh deploy** so the function picks up the new vars.

## 5. Test the flow (10 min, in test mode)

1. Open `https://sc-project-tracker.pages.dev/signup` and create a test account
2. The app puts you on a 14-day Pro trial (no Stripe yet — that's the optimistic state)
3. Build the upgrade flow (`/billing/upgrade?tier=pro`) — TODO, Phase 3.5 in this chat
4. Click "Upgrade" → calls `/api/stripe-checkout` → redirects to Stripe-hosted checkout
5. Use a Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC, any zip
6. Complete payment → Stripe sends `checkout.session.completed` webhook → Firestore updates
7. Verify `tenants/{your-test-tenant}/subscription/current` shows `status: active, planId: pro`

## 6. Go live (when ready)

- Switch your Stripe account from Test to Live mode (top-right toggle)
- Replace `sk_test_...` with `sk_live_...` and update each `price_*` to the live equivalents
- Update the webhook endpoint to point at the live URL once you cut DNS

## What's NOT done yet (Phase 3.5+ work)

- 🔨 **Webhook signature verification** — `functions/api/stripe-webhook.ts` has the TODO. Web Crypto HMAC-SHA256 against the request body.
- 🔨 **Firestore writes from the webhook** — needs the service-account JWT signing flow.
- 🔨 **Billing UI** (`/billing/upgrade` page, Customer Portal link, trial banner)
- 🔨 **Idempotency** — `stripe_events_seen/{eventId}` doc check before processing
- 🔨 **Email triggers** — branded "card failed", "trial ending" via Resend (Phase 3.5 dep)

The `/api/stripe-checkout` endpoint IS production-ready once the env vars are set — that's the only piece needed for users to start paying. The webhook can be filled in later (Stripe will retry events for ~3 days).
