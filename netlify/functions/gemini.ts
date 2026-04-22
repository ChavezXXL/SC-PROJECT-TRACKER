// netlify/functions/gemini.ts
// Server-side Gemini proxy. Keeps API key OFF the frontend.
// Accepts base64 image + prompt, returns extracted data.

import type { Handler } from '@netlify/functions';

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
];

// Per-model timeout — Gemini normally responds in 3-8s; anything past 20s is stuck.
const UPSTREAM_TIMEOUT_MS = 20_000;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(status: number, body: Record<string, unknown>) {
  return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export const handler: Handler = async (event) => {
  // CORS preflight + client-side health probe (see AIHealthPanel in Settings).
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
      body: JSON.stringify({ ok: true }),
    };
  }

  // Lightweight GET health-check — returns whether the key is configured without
  // actually calling Gemini. Used by the Settings AI Status panel.
  if (event.httpMethod === 'GET') {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    return json(200, { ok: true, keyConfigured: !!apiKey });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Prefer GEMINI_API_KEY (server-only), fall back to legacy VITE_GEMINI_API_KEY during migration
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return json(500, {
      error: 'Gemini API key not configured. Add GEMINI_API_KEY in Netlify → Site settings → Environment variables.',
      code: 'AUTH',
    });
  }

  let payload: { prompt: string; imageBase64?: string; mimeType?: string };
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { prompt, imageBase64, mimeType = 'image/jpeg' } = payload;

  if (!prompt || prompt.length > 8000) {
    return json(400, { error: 'Invalid prompt' });
  }

  // Size guard — prevent abuse. 5MB base64 ~= 3.75MB raw image.
  if (imageBase64 && imageBase64.length > 5_000_000) {
    return json(400, { error: 'Image too large (max 3.75MB raw)' });
  }

  const parts: any[] = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  let lastError: string = 'All models failed';
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
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return json(200, { text, model });
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;

      // 429 billing cap / 401/403 bad key = fail immediately, don't burn more calls
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        const code = res.status === 429 ? 'BILLING' : 'AUTH';
        return json(res.status, { error: errMsg, code });
      }

      // Other errors (404/503) — try next model
      lastError = `${res.status}: ${errMsg}`;
      console.warn(`[gemini] ${model} failed:`, lastError);
    } catch (e: any) {
      // AbortError means the upstream took too long — try the next model
      lastError = e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'Unknown fetch error');
      console.warn(`[gemini] ${model} threw:`, lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  return json(502, { error: lastError });
};
