// geminiService.ts
// Uses direct REST calls to Gemini 2.0 Flash — no SDK dependency required.

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

async function callGemini(parts: GeminiPart[]): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "VITE_GEMINI_API_KEY is not set. Add it to your .env or Netlify env vars."
    );
  }

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export interface JobDetails {
  poNumber?: string;
  partNumber?: string;
  quantity?: number | null;
  dueDate?: string;
  customer?: string;
  notes?: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
}

export async function parseJobDetails(text: string): Promise<JobDetails> {
  const prompt = `
You are a data extraction assistant for a metal deburring shop.
Extract job details from the text below and return ONLY a JSON object with these keys:
  poNumber   – the purchase order number (string)
  partNumber – the part number or item number (string)
  quantity   – how many pieces (number or null)
  dueDate    – due / ship / delivery date in ISO-8601 (YYYY-MM-DD) or null
  customer   – company or customer name (string)
  notes      – special instructions, material, finish, or other relevant info (string)
  priority   – one of "LOW", "NORMAL", "HIGH", "URGENT" based on any urgency keywords

Use null for any field you cannot find. Return ONLY valid JSON, no markdown fences.

TEXT:
${text}
`.trim();

  const raw = await callGemini([{ text: prompt }]);
  try {
    return JSON.parse(stripJsonFences(raw)) as JobDetails;
  } catch {
    console.error("parseJobDetails: could not parse JSON →", raw);
    return {};
  }
}

export async function analyzePOImage(
  base64Image: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg"
): Promise<JobDetails> {
  const prompt = `
This is a photograph of a Purchase Order document from a manufacturing customer.
Extract every job-relevant detail and return ONLY a JSON object with these keys:
  poNumber   – PO number / order number (string)
  partNumber – part number, item #, or product code (string)
  quantity   – quantity ordered (number or null)
  dueDate    – due date / delivery date / ship date in ISO-8601 (YYYY-MM-DD) or null
  customer   – customer company name (string)
  notes      – special instructions, material spec, finish, tolerances, or any other notes (string)
  priority   – one of "LOW", "NORMAL", "HIGH", "URGENT" based on urgency language like "RUSH", "ASAP", etc.

Use null for any field not found. Return ONLY valid JSON, no markdown fences.
`.trim();

  const raw = await callGemini([
    { inline_data: { mime_type: mimeType, data: base64Image } },
    { text: prompt },
  ]);

  try {
    return JSON.parse(stripJsonFences(raw)) as JobDetails;
  } catch {
    console.error("analyzePOImage: could not parse JSON →", raw);
    return {};
  }
}

export async function chatWithBot(
  userMessage: string,
  jobContext?: string
): Promise<string> {
  const systemNote = jobContext
    ? `Current job data (JSON): ${jobContext}\n\n`
    : "";

  const prompt = `
You are SC Assistant, a friendly AI helper for SC Deburring, a metal parts deburring shop.
You help shop staff track jobs, answer questions about job status, due dates, priorities, and general shop operations.
Be concise, practical, and professional.
${systemNote}User: ${userMessage}
`.trim();

  return callGemini([{ text: prompt }]);
}
