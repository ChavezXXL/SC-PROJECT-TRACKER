// ═════════════════════════════════════════════════════════════════════
// /api/gemini — Cloudflare Pages Function
//
// Server-side Gemini proxy. Keeps the API key off the client.
// Behavior matches the old Netlify function exactly so the client code
// (POScanner, AIHealthPanel) requires no changes.
//
// URL: POST /api/gemini  · GET /api/gemini (health check)
//
// Env vars (set with `wrangler pages secret put GEMINI_API_KEY`):
//   GEMINI_API_KEY  — Gemini API key (server-only)
// ═════════════════════════════════════════════════════════════════════

interface Env {
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;  // legacy fallback during migration
}

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
];

const UPSTREAM_TIMEOUT_MS = 20_000;
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
  }

  const apiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY;

  // Lightweight health probe — no API call.
  if (request.method === 'GET') {
    return json(200, { ok: true, keyConfigured: !!apiKey });
  }

  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  if (!apiKey) {
    return json(500, {
      error: 'Gemini API key not configured. Set GEMINI_API_KEY in Cloudflare → Pages → Settings → Environment Variables.',
      code: 'AUTH',
    });
  }

  let payload: { prompt: string; imageBase64?: string; mimeType?: string };
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { prompt, imageBase64, mimeType = 'image/jpeg' } = payload;

  if (!prompt || prompt.length > 8000) {
    return json(400, { error: 'Invalid prompt' });
  }
  if (imageBase64 && imageBase64.length > 5_000_000) {
    return json(400, { error: 'Image too large (max 3.75MB raw)' });
  }

  const parts: any[] = [{ text: prompt }];
  if (imageBase64) parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });

  const body = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };

  let lastError = 'All models failed';
  for (const model of GEMINI_MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        },
      );

      if (res.ok) {
        const data: any = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return json(200, { text, model });
      }

      const errData: any = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;

      if (res.status === 429 || res.status === 401 || res.status === 403) {
        const code = res.status === 429 ? 'BILLING' : 'AUTH';
        return json(res.status, { error: errMsg, code });
      }

      lastError = `${res.status}: ${errMsg}`;
      console.warn(`[gemini] ${model} failed:`, lastError);
    } catch (e: any) {
      lastError = e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'Unknown fetch error');
      console.warn(`[gemini] ${model} threw:`, lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  return json(502, { error: lastError });
};
