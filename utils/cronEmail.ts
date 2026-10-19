// ═════════════════════════════════════════════════════════════════════
// Email for the scheduled functions (Resend). A sender is injected into each
// cron's run function, so tests can swap in a fake and assert what was sent.
// Never throws — a failed send comes back as { ok: false, error }.
// ═════════════════════════════════════════════════════════════════════

export interface EmailMessage { to: string[]; subject: string; html: string; text?: string }
export interface EmailResult { ok: boolean; id?: string; error?: string }
export type EmailSender = (msg: EmailMessage) => Promise<EmailResult>;

export const DEFAULT_EMAIL_FROM = 'FabTrack IO <noreply@scprecisiondeburring.com>';

export function createResendSender(apiKey: string, from: string = DEFAULT_EMAIL_FROM, fetchImpl?: typeof fetch): EmailSender {
  const doFetch: typeof fetch = fetchImpl || ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async (msg) => {
    try {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, ...(msg.text ? { text: msg.text } : {}) }),
      });
      const body: any = await res.json().catch(() => null);
      if (!res.ok) {
        const why = body?.message || body?.name || body?.error || '';
        return { ok: false, error: `Resend ${res.status}${why ? `: ${String(why).slice(0, 200)}` : ''}` };
      }
      return { ok: true, id: body?.id };
    } catch (e: any) {
      return { ok: false, error: `Resend unreachable: ${String(e?.message || e).slice(0, 200)}` };
    }
  };
}
