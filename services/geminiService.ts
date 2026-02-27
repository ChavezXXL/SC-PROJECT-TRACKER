// geminiService.ts
// Unified Gemini REST helper - header-based API key, inline_data for images.
// MM/DD/YYYY date format standardised across all prompts.

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;

const GEMINI_MODELS = [
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.5-flash',
];

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

async function callGemini(parts: GeminiPart[]): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('VITE_GEMINI_API_KEY is not set. Add it to your .env or Netlify env vars.');
  }
  let lastError: any;
  for (const model of GEMINI_MODELS) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error('Gemini ' + res.status + ': ' + err);
      }
      const json = await res.json();
      return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    } catch (err: any) {
      lastError = err;
      console.warn('callGemini: model ' + model + ' failed:', err.message);
      continue;
    }
  }
  throw lastError;
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export interface JobDetails {
  poNumber?: string;
  partNumber?: string;
  quantity?: number | null;
  dueDate?: string;
  customer?: string;
  notes?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}

export async function parseJobDetails(text: string): Promise<JobDetails> {
  const prompt = 'You are a data extraction assistant for a metal deburring shop.\nExtract job details from the text below and return ONLY a JSON object with these keys:\n  poNumber  - the purchase order number (string)\n  partNumber - the part number or item number (string)\n  quantity  - how many pieces (number or null)\n  dueDate   - due / ship / delivery date formatted as MM/DD/YYYY (string or null)\n  customer  - company or customer name (string)\n  notes     - special instructions, material, finish, or other relevant info (string)\n  priority  - one of "LOW", "NORMAL", "HIGH", "URGENT" based on any urgency keywords\n\nUse null for any field you cannot find.\nReturn ONLY valid JSON, no markdown fences.\n\nTEXT:\n' + text;

  const raw = await callGemini([{ text: prompt }]);
  try {
    return JSON.parse(stripJsonFences(raw)) as JobDetails;
  } catch {
    console.error('parseJobDetails: could not parse JSON ->', raw);
    return {};
  }
}

export async function analyzePOImage(
  base64Image: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<JobDetails> {
  const prompt = 'This is a photograph of a Purchase Order document from a manufacturing customer.\nExtract every job-relevant detail and return ONLY a JSON object with these keys:\n  poNumber   - PO number / order number (string)\n  partNumber - part number, item #, or product code (string)\n  quantity   - quantity ordered (number or null)\n  dueDate    - due date / delivery date / ship date formatted as MM/DD/YYYY (string or null)\n  customer   - customer company name (string)\n  notes      - special instructions, material spec, finish, tolerances, or any other notes (string)\n  priority   - one of "LOW", "NORMAL", "HIGH", "URGENT" based on urgency language like "RUSH", "ASAP", etc.\n\nUse null for any field not found.\nReturn ONLY valid JSON, no markdown fences.';

  const raw = await callGemini([
    { inline_data: { mime_type: mimeType, data: base64Image } },
    { text: prompt },
  ]);
  try {
    return JSON.parse(stripJsonFences(raw)) as JobDetails;
  } catch {
    console.error('analyzePOImage: could not parse JSON ->', raw);
    return {};
  }
}

export async function chatWithBot(
  userMessage: string,
  jobContext?: string
): Promise<string> {
  const systemNote = jobContext ? 'Current job data (JSON): ' + jobContext + '\n\n' : '';
  const prompt = 'You are SC Assistant, a friendly AI helper for SC Deburring, a metal parts deburring shop.\nYou help shop staff track jobs, answer questions about job status, due dates, priorities,\nand general shop operations. Be concise, practical, and professional.\n' + systemNote + 'User: ' + userMessage;
  return callGemini([{ text: prompt }]);
}
