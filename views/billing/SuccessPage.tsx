// ═════════════════════════════════════════════════════════════════════
// /billing/success — Post-Stripe-Checkout landing page.
//
// Stripe redirects here with ?session_id=cs_xxx. We:
//   1. Call /api/stripe-session-verify to get session + subscription details
//   2. Write subscription state to tenants/{tid}/subscription/current
//   3. Show a confirmation + "Continue to app" CTA
//
// MVP: Firestore write happens client-side from the user's authenticated
// session. Phase 3.5 adds webhook hardening so this becomes redundant
// belt-and-suspenders.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import { useTenant } from '../../backend/useTenant';
import { AuthShell, PrimaryButton } from '../auth/AuthShell';
import { mapStripeStatus } from '../../backend/billingService';

type Phase = 'verifying' | 'saving' | 'done' | 'error';

export const SuccessPage: React.FC = () => {
  const { tenant } = useTenant();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [planLabel, setPlanLabel] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    (async () => {
      if (!tenant) {
        setErrorMsg('No tenant context. Please sign in again.');
        setPhase('error');
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session_id');
      if (!sessionId) {
        setErrorMsg('Missing session_id in URL.');
        setPhase('error');
        return;
      }

      try {
        // 1. Verify session server-side (uses Stripe secret key)
        const res = await fetch(`/api/stripe-session-verify?session_id=${encodeURIComponent(sessionId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err?.error || 'Could not verify your payment. Please contact support.');
        }
        const data = await res.json() as {
          planId: string;
          interval: 'month' | 'year';
          status: string;
          stripeCustomerId: string;
          stripeSubscriptionId: string;
          stripePriceId: string;
          currentPeriodEnd: number;
        };
        const { planId, interval, status, stripeCustomerId, stripeSubscriptionId, stripePriceId, currentPeriodEnd } = data;

        setPlanLabel(planId);
        setPhase('saving');

        // 2. Write subscription doc to Firestore (client-side; rules permissive in current state)
        const db = getFirestore();
        const subPath = `tenants/${tenant.id}/subscription/current`;
        await setDoc(doc(db, subPath), {
          tenantId: tenant.id,
          planId,
          status: mapStripeStatus(status),
          interval: interval || 'month',
          seats: 1,
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          currentPeriodEnd: currentPeriodEnd ? currentPeriodEnd * 1000 : null,
          updatedAt: Date.now(),
        }, { merge: true });

        setPhase('done');
      } catch (e: any) {
        setErrorMsg(e?.message || 'Something went wrong. Try refreshing.');
        setPhase('error');
      }
    })();
  }, [tenant]);

  if (phase === 'error') {
    return (
      <AuthShell title="Hmm — that didn't go right" subtitle={errorMsg}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Your payment may have still gone through. We'll reconcile via webhook within a few minutes.
            If your account doesn't unlock, email <a className="text-blue-400" href="mailto:support@fabtrack.io">support@fabtrack.io</a> with your shop name.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-400 hover:text-blue-300"
          >
            ← Back to the app
          </a>
        </div>
      </AuthShell>
    );
  }

  if (phase === 'verifying' || phase === 'saving') {
    return (
      <AuthShell title="Activating your plan…">
        <div className="text-sm text-zinc-300 text-center py-4">
          <div className="animate-pulse text-3xl mb-3">✨</div>
          <p>{phase === 'verifying' ? 'Verifying your payment with Stripe…' : 'Unlocking your features…'}</p>
        </div>
      </AuthShell>
    );
  }

  // Done
  return (
    <AuthShell
      title="You're in 🎉"
      subtitle={`Your ${planLabel} plan is active. Welcome to FabTrack IO.`}
    >
      <PrimaryButton type="button" onClick={() => { window.location.href = '/'; }}>
        Open the app →
      </PrimaryButton>
      <p className="mt-3 text-[11px] text-center text-zinc-500">
        We sent a receipt to your billing email. Manage your subscription any time at <a className="text-zinc-300" href="/billing">/billing</a>.
      </p>
    </AuthShell>
  );
};
