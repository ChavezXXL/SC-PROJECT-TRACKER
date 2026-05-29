/**
 * Browser-side email via EmailJS REST API — no backend required.
 *
 * Setup (admin one-time):
 *   1. Create account at https://www.emailjs.com (free tier: 200 emails/mo)
 *   2. Add an Email Service (Gmail, Outlook, SMTP, etc.)
 *   3. Create a Template with variables — at minimum:
 *        {{job_id}}, {{po}}, {{part}}, {{customer}}, {{estimated}},
 *        {{actual}}, {{over_by}}, {{operations}}, {{shop_name}}, {{link}}
 *   4. Copy Service ID, Template ID, and Public Key into
 *      Settings → Operations → Rate Samples
 *
 * Why EmailJS over Resend/SendGrid: zero backend code, no API key
 * baked into a Worker, no domain setup. Trade-off: per-month volume
 * limits and the API key is technically visible in browser network
 * tools (but it's a "public key" by design — EmailJS validates the
 * referrer + has per-key rate limits).
 *
 * Public docs: https://www.emailjs.com/docs/rest-api/send/
 */

import type { SystemSettings } from '../types';

export interface OverBudgetEmailPayload {
  jobIdDisplay: string;
  poNumber: string;
  partNumber: string;
  customer: string;
  estimatedHours: number;
  actualHours: number;
  overByHours: number;
  operations: string;       // comma-separated list of operations
  shopName: string;
  jobUrl: string;
}

interface EmailJsConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
  toEmail: string;
}

/** Pull EmailJS settings out of SystemSettings if all required fields are set. */
export function getEmailJsConfig(settings: SystemSettings): EmailJsConfig | null {
  const serviceId = (settings.emailJsServiceId || '').trim();
  const templateId = (settings.emailJsTemplateId || '').trim();
  const publicKey = (settings.emailJsPublicKey || '').trim();
  const toEmail = (settings.alertEmail || settings.companyEmail || '').trim();
  if (!serviceId || !templateId || !publicKey || !toEmail) return null;
  return { serviceId, templateId, publicKey, toEmail };
}

/**
 * Fire an over-budget email via EmailJS. Returns true on success, false
 * on any failure (logged but never throws — alerts should never crash
 * the app). Safe to call without config; will just no-op.
 */
export async function sendOverBudgetEmail(
  settings: SystemSettings,
  payload: OverBudgetEmailPayload,
): Promise<boolean> {
  const cfg = getEmailJsConfig(settings);
  if (!cfg) return false;

  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:   cfg.serviceId,
        template_id:  cfg.templateId,
        user_id:      cfg.publicKey,
        template_params: {
          to_email:   cfg.toEmail,
          job_id:     payload.jobIdDisplay,
          po:         payload.poNumber,
          part:       payload.partNumber,
          customer:   payload.customer,
          estimated:  payload.estimatedHours.toFixed(2) + 'h',
          actual:     payload.actualHours.toFixed(2) + 'h',
          over_by:    payload.overByHours.toFixed(2) + 'h',
          operations: payload.operations,
          shop_name:  payload.shopName,
          link:       payload.jobUrl,
        },
      }),
    });
    if (!res.ok) {
      console.warn('[emailNotify] EmailJS returned', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[emailNotify] send failed:', e);
    return false;
  }
}

/** Test-fire — used by the Settings "Send Test Email" button. */
export async function sendTestEmail(settings: SystemSettings): Promise<{ ok: boolean; reason?: string }> {
  const cfg = getEmailJsConfig(settings);
  if (!cfg) return { ok: false, reason: 'Missing EmailJS service/template/key, or no recipient email' };
  const ok = await sendOverBudgetEmail(settings, {
    jobIdDisplay: 'TEST-0001',
    poNumber:     'PO-TEST',
    partNumber:   'TEST-PART',
    customer:     'Test Customer',
    estimatedHours: 5,
    actualHours:    7.5,
    overByHours:    2.5,
    operations:   'deburr, polish, qc',
    shopName:     settings.companyName || 'Your Shop',
    jobUrl:       window.location.origin,
  });
  return ok ? { ok: true } : { ok: false, reason: 'EmailJS request failed — check IDs and recipient email' };
}
