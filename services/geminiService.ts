// geminiService.ts
// All Gemini calls go through /.netlify/functions/gemini so the API key
// stays SERVER-SIDE and is never shipped to the browser bundle.
// MM/DD/YYYY date format standardised across all prompts.

async function callGemini(prompt: string, imageBase64?: string, mimeType: string = 'image/jpeg'): Promise<string> {
  const res = await fetch('/.netlify/functions/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, imageBase64, mimeType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err?.code || '';
    const msg = err?.error || `HTTP ${res.status}`;
    if (code === 'BILLING' || res.status === 429) {
      throw new Error('Gemini spending cap reached. Raise the limit at https://ai.studio/billing.');
    }
    if (code === 'AUTH') {
      throw new Error('Gemini API key invalid. Check Netlify env vars.');
    }
    throw new Error(msg);
  }
  const { text } = await res.json();
  return (text || '').trim();
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
  const prompt = 'Extract job details from the text below. Return ONLY JSON with keys: poNumber, partNumber, quantity (number or null), dueDate (MM/DD/YYYY or null), customer, notes (deburring-relevant only, short), priority (LOW/NORMAL/HIGH/URGENT). Use null for missing fields. No markdown.\n\nTEXT:\n' + text;
  const raw = await callGemini(prompt);
  try {
    return JSON.parse(stripJsonFences(raw)) as JobDetails;
  } catch {
    console.error('parseJobDetails: invalid JSON ->', raw);
    return {};
  }
}

export async function analyzePOImage(
  base64Image: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<JobDetails> {
  const prompt = 'Extract PO details from this image. Return ONLY JSON with keys: poNumber, partNumber, quantity (number or null), dueDate (MM/DD/YYYY or null), customer, notes (deburring-relevant only, short), priority (LOW/NORMAL/HIGH/URGENT based on urgency words like RUSH/ASAP). Use null for missing. No markdown.';
  const raw = await callGemini(prompt, base64Image, mimeType);
  try {
    return JSON.parse(stripJsonFences(raw)) as JobDetails;
  } catch {
    console.error('analyzePOImage: invalid JSON ->', raw);
    return {};
  }
}

export async function chatWithBot(userMessage: string, jobContext?: string): Promise<string> {
  const systemNote = jobContext ? 'Current job data (JSON): ' + jobContext + '\n\n' : '';
  const prompt = 'You are SC Assistant for a metal deburring shop. Be concise and practical.\n' + systemNote + 'User: ' + userMessage;
  return callGemini(prompt);
}
