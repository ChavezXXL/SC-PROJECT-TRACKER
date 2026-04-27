# FabTrack IO — Operator & Admin Console

> Answers: *"How do these other SaaS companies do it? How do devs get
> special access? How does a company ban accounts, detect missed
> payments, send reminder emails?"*
>
> Short answer: **Stripe + Firebase Auth + Firestore flags + a hidden
> `/admin` route that only you can see.** Every SaaS runs this exact
> playbook. Below is the map.

---

## 1. Super-Admin Access (god mode for us)

### How others do it
- **Linear / Vercel / Stripe Dashboard** — internal employees have a flag on their account (usually `is_staff`, `role: 'employee'`, or `superuser`). When present, the app unlocks extra UI — a customer impersonation button, a "view any tenant" switcher, and a `/admin` route.
- It's **never set from the client**. Always set manually in the database or by a CLI script.
- All privileged actions are **audit-logged** so no one can quietly tamper with customer data without leaving a trail.

### How we do it
The `Account` type has `superAdmin?: boolean`. Three things happen when it's `true`:

1. **Firestore rules** (`firestore.rules.draft` → `isSuperAdmin()`) — read/write any tenant, bypass status checks.
2. **Feature gate** (`featureFlags.ts` → `super_admin_bypass`) — see all features regardless of plan.
3. **UI reveals** — the app renders a `/admin` route (Phase 6) with:
   - **Tenant list** — every paying + trial customer, sortable by MRR, last login, health.
   - **Tenant switcher** — "view as" impersonation (time-limited, audit-logged).
   - **Ban/suspend buttons** — see §3.
   - **Comp plan** — manually set a tenant's plan to Pro/FabTrack IO without Stripe (for friends, beta testers, internal).
   - **Feature overrides** — force-enable a specific feature for one tenant regardless of tier.
   - **Force webhook replay** — re-run a Stripe event against our handler.
   - **Audit log** — every super-admin action logged (`operator_audit/{id}`).

### How `superAdmin: true` gets set
Options, in order of preference:
1. **Firebase Console → Firestore → `accounts/{your-uid}` → edit `superAdmin: true`.** Manual, one-time.
2. **CLI script** (`scripts/ops-grant-admin.ts` — Phase 5). Runs with service account credentials.
3. **Hard-coded email allowlist** in a Netlify Function as backup (e.g. `anthony@scdeburring.com` always super-admin).

### What about multiple staff later
Add more `superAdmin: true` records for each team member. They all see `/admin`. You can also add a `role: 'ops' | 'support' | 'founder'` if you want different levels of access within the staff.

---

## 2. Automated Payment Detection (no one has to watch manually)

### How others do it
- Every SaaS using Stripe relies on **webhooks** — Stripe's server-to-server event stream. Events fire the instant something happens: a card is charged, a card fails, a trial is about to end.
- Stripe's **Smart Retries** automatically re-tries failed cards up to 4 times over 3 weeks. You don't manually "check if someone paid" — Stripe tells you.
- The app listens for these events, updates subscription state in its own DB, and triggers emails or UI changes.

### How we do it
**The webhook handler lives in `netlify/functions/stripe-webhook.ts`** (to be built in Phase 3). It's called by Stripe whenever a billing event fires. Handler verifies the signature, then updates Firestore.

Event flow diagram:

```
Customer's card declines
        │
        ▼
  Stripe attempts 1st retry (3 days later)
        │
        ├── success → invoice.payment_succeeded event
        │               → webhook sets subscription.status = 'active'
        │               → in-app past-due banner clears
        │
        └── still fails → invoice.payment_failed event
                          → webhook:
                              • subscription.status = 'past_due'
                              • subscription.lastPaymentFailedAt = now
                              • tenant.status = 'past_due'
                              • send our branded "Card failed" email
                              • show in-app banner
                          → Stripe retries again in 5 days
                          → if retries exhausted:
                              → customer.subscription.updated with status='unpaid'
                              → webhook:
                                  • subscription.status = 'unpaid'
                                  • send "Payment failed — final" email
                                  • app goes read-only for this tenant
```

### Event types we listen for
(Defined in `billingService.ts → StripeWebhookEventType`.)

| Event | What we do |
|---|---|
| `checkout.session.completed` | Create `subscription/current` doc, send welcome email |
| `customer.subscription.updated` | Sync plan change, seats, status |
| `customer.subscription.deleted` | Mark canceled, schedule data retention |
| `customer.subscription.trial_will_end` | Send "trial ending in 3 days" email |
| `invoice.payment_succeeded` | Clear past-due state, send receipt |
| `invoice.payment_failed` | Set past-due, send dunning email |
| `invoice.upcoming` | Send "invoice due in 7 days" nudge |

Every handler is **idempotent** — Stripe occasionally re-delivers events, so we guard by Stripe event ID in a `stripe_events_seen/{id}` doc.

### Stripe Smart Retries — turn it on
In Stripe Dashboard → Billing → Subscriptions → Settings:
- ✅ **Smart Retries** enabled (retries failed cards intelligently)
- ✅ **Revenue Recovery** emails enabled (Stripe sends its own branded reminders on top of ours — belt + suspenders)
- ✅ **Trial ending emails** enabled (3 days + 1 day warnings)

---

## 3. Banning & Suspending Accounts

### Three levels of restriction, each with different effect

| Action | What happens | When to use |
|---|---|---|
| **Suspend tenant** | All tenant reads/writes return `permission-denied`. Users see "Account suspended" screen. | TOS violation, fraud, chargeback, abuse. Recoverable. |
| **Pause tenant** | Logins blocked except to billing page. Good for 30+ day unpaid accounts. | Automatic after dunning cycle. |
| **Ban account** | The individual user can't sign in anywhere, even to accept invites. | Shared-credential abuse, fraudulent signups. |

### How bans work in our stack

**Tenant-level suspension:**
- `tenants/{tid}.status = 'suspended'`
- Firestore rules check this in every `match` block (`tenantIsActive()`).
- Feature gate returns `reason: 'tenant_suspended'` → UpgradeNudge shows "Account suspended" card.
- Operator can unsuspend by flipping the flag.

**Account-level ban (nuclear option):**
- `accounts/{uid}.banned = true`
- Firestore rules refuse any read/write including reading own account doc.
- Firebase Auth side: also call `admin.auth().updateUser(uid, { disabled: true })` — kills the session immediately. (Stubbed in `opsBanAccount()`.)
- Banned user sees "This account has been suspended" on next page load.

### How other companies do it
- **Stripe** — `account.disabled` flag + hard block in the auth middleware. Emails user the reason. Appeals go to a support queue.
- **GitHub** — same pattern; uses a `suspended_at` timestamp + `suspension_reason`.
- **Shopify** — takes down the whole store; customers see a holding page; back-end data preserved.

Ours mirrors this. See `opsSuspendTenant()` / `opsBanAccount()` stubs in `authService.ts`.

### Audit trail — non-optional
Every operator action writes to `operator_audit/{id}`:
```ts
{
  operatorUid: 'your-uid',
  operatorEmail: 'anthony@scdeburring.com',
  action: 'tenant.suspend',
  targetTenantId: 'sketchy-shop',
  reason: 'chargeback initiated 2026-05-01',
  at: 1714521600000
}
```
Shown in the `/admin` audit log tab. Answers "what did we change, when, and why" when we inevitably need to remember.

---

## 4. Email System (reminders, receipts, nudges)

### Who sends what

| Email | Sender | Trigger |
|---|---|---|
| Welcome | Our backend (Resend) | Signup |
| Email verification | Firebase Auth | Signup |
| Password reset | Firebase Auth | Forgot password |
| Trial ending 3 days | Our backend | `trial_will_end` webhook |
| Trial ending 1 day | Our backend | Scheduled Netlify cron |
| Trial ended | Our backend | Trial expiry cron |
| Card failed (1st) | Our backend | `invoice.payment_failed` webhook |
| Card failed (final) | Our backend | Final retry failure |
| Paused account | Our backend | 30-day unpaid cron |
| Subscription canceled | Our backend | `customer.subscription.deleted` |
| Teammate invite | Our backend | Invite created |
| Invoice receipt | **Stripe** | Payment succeeded (free, auto) |
| Upcoming invoice | Stripe | 7 days before renewal (free, auto) |

### Transactional email provider
- **Firebase Auth** handles: email verification, password reset, magic links. Free. Branded with their domain by default; can customize in Firebase Console.
- **Resend** or **Postmark** for everything else. Both ~$10-20/mo for our volume. Nice developer experience, high deliverability, React-based templates.

Chosen provider: **Resend** (cheaper, modern API). Feature flag it so we can swap.

### Template list (source of truth)
See `billingService.ts → TransactionalEmailTemplate`.

### Scheduled (cron) emails
Some emails fire on a schedule, not a webhook:
- Trial ending 1-day reminder — runs every hour in a Netlify scheduled function, finds trials with `trialEndsAt` within 24h, emails.
- Paused-account cutoff — runs daily, finds unpaid-for-30-days accounts, sends "paused" email + flips status.

Netlify Scheduled Functions handle this — cheap, reliable, versioned in git.

---

## 5. Account Creation via Email

### The flow (Phase 2)

1. User lands on `fabtrack.io/signup`.
2. Enters email + password (or clicks "Continue with Google").
3. Firebase Auth creates the user, returns UID.
4. Our backend (Netlify Function):
   - creates `accounts/{uid}`
   - creates `tenants/{tid}` with slug from tenant name
   - creates `tenants/{tid}/members/{uid}` (role=owner)
   - creates `tenants/{tid}/subscription/current` (status=trialing, 14d)
   - sends welcome email via Resend
5. Firebase Auth sends a verification email.
6. User is redirected to the 5-question shop profile wizard.
7. After wizard → redirected to `/overview`.

### Security note — why server-side tenant creation
Don't trust the client to create the tenant/owner record. If the client does it and we're not careful, a malicious user could create a tenant and then assign themselves `superAdmin: true` in the same request. Always hand the signup flow to a Netlify Function with Firebase Admin SDK — that can enforce all the invariants (no self-promotion, no reused slugs, no reserved tenant IDs).

### Inviting teammates (Phase 5)
1. Owner/admin enters a teammate's email in `/team`.
2. Backend creates `invites/{id}` with a token, 7-day expiry.
3. Teammate gets "You've been invited" email with a one-click accept link.
4. Accept page (logged-out OK) verifies the token → Firebase Auth signup/login → creates `members/{uid}` with the invited role.

---

## 6. Impersonation ("View as customer")

When a customer emails support with a bug report, we need to see what they see — but **without ever having their password**.

### How others do it
- **Stripe Dashboard** — "Test mode" + "View as account" button. Requires staff auth.
- **Intercom** — "login as" with time-limited tokens, all actions logged.

### How we do it (Phase 6)
1. Super-admin clicks "View as" in `/admin/tenants/{tid}`.
2. Backend creates a temp Firebase Auth custom token with claim `impersonating: tid, opUid: 'our-uid', expiresAt: now+15min`.
3. Frontend redirects to the tenant with banner: **"You're viewing as Acme Machining — click to exit."**
4. All Firestore writes are logged with the `op-impersonating-{our-uid}` flag so we know which changes weren't the real customer.
5. Session auto-expires after 15 minutes.

Not optional — this is **the** tool for debugging customer issues without playing email-tag.

---

## 7. Putting it all together — `/admin` route (Phase 6)

```
/admin
  ├── tenants/                   all tenants, sortable by MRR/health/last-login
  │    ├── {tid}
  │    │    ├── overview          metrics: MRR, users, jobs this month
  │    │    ├── billing           subscription state, invoices, comp plan
  │    │    ├── members           add/remove, change roles
  │    │    ├── feature-overrides force-enable specific features
  │    │    └── actions           suspend / unsuspend / impersonate / delete
  ├── accounts/                  all accounts across all tenants
  │    ├── {uid}/                ban / unban / email / link to tenants
  ├── payments/                  failed payments, pending retries, MRR chart
  ├── emails/                    sent log, template previews, resend button
  ├── audit/                     operator action log (read-only)
  └── system/                    feature-flag config, Stripe webhook replay, cache clear
```

Access gated by `account.superAdmin === true`. Never linked from the public app — you bookmark it.

---

## 8. Reality check — what we DON'T need to build

Stripe handles (free, just turn it on):
- Payment retries (Smart Retries)
- Card-expiring-soon emails
- Invoice payment reminders
- Failed-payment reminders (basic version)
- Hosted checkout page
- Hosted customer portal (manage card, cancel, view invoices)
- Tax calculation (with Stripe Tax)
- Dunning strategy (built-in)

Firebase Auth handles (free):
- Email/password signup + login
- Email verification
- Password reset
- Google / Apple / Microsoft SSO
- Magic links
- Custom claims (for super-admin + impersonation)
- Rate limiting

That leaves us writing:
- Webhook handler (~200 lines)
- `/signup` page (~100 lines)
- `/admin` routes (real lift — ~500-1000 lines across Phase 6)
- Transactional emails (~50 lines per template)
- Branded-email templates (copy work, not code)

Most of the hard parts are solved problems. Our job is wiring + branding.
