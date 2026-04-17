// netlify/functions/gemini.ts
// Server-side Gemini proxy. Keeps API key OFF the frontend.
// Accepts base64 image + prompt, returns extracted data.

import type { Handler } from '@netlify/functions';

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
];

export const handler: Handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Prefer GEMINI_API_KEY (server-only), fall back to legacy VITE_GEMINI_API_KEY during migration
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Gemini API key not configured on server.' }),
    };
  }

  let payload: { prompt: string; imageBase64?: string; mimeType?: string };
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { prompt, imageBase64, mimeType = 'image/jpeg' } = payload;

  if (!prompt || prompt.length > 8000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid prompt' }) };
  }

  // Size guard — prevent abuse. 5MB base64 ~= 3.75MB raw image.
  if (imageBase64 && imageBase64.length > 5_000_000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Image too large (max 3.75MB raw)' }) };
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
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
          statusCode: 200,
          body: JSON.stringify({ text, model }),
        };
      }

      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP ${res.status}`;

      // 429 billing cap / 401/403 bad key = fail immediately, don't burn more calls
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        const code = res.status === 429 ? 'BILLING' : 'AUTH';
        return {
          statusCode: res.status,
          body: JSON.stringify({ error: errMsg, code }),
        };
      }

      // Other errors (404/503) — try next model
      lastError = `${res.status}: ${errMsg}`;
      console.warn(`[gemini] ${model} failed:`, lastError);
    } catch (e: any) {
      lastError = e?.message || 'Unknown fetch error';
      console.warn(`[gemini] ${model} threw:`, lastError);
    }
  }

  return {
    statusCode: 502,
    body: JSON.stringify({ error: lastError }),
  };
};
