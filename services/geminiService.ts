import { SmartPasteData } from "../types";

const GEMINI_API_KEY = (import.meta as any).env?.VITE_GEMINI_API_KEY || (process as any).env?.API_KEY || '';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash';

export const parseJobDetails = async (rawText: string): Promise<SmartPasteData> => {
  const res = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Extract manufacturing job details from this text. Return ONLY valid JSON with keys: poNumber (string), partNumber (string), quantity (number), dueDate (string YYYY-MM-DD), customer (string), notes (string). Use null for missing values.\n\nText: "${rawText}"` }] }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from AI');
  return JSON.parse(text.replace(/```json|```/g, '').trim()) as SmartPasteData;
};

export const analyzePOImage = async (base64Image: string, mimeType: string): Promise<SmartPasteData> => {
  const res = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType, data: base64Image } },
        { text: `Analyze this Purchase Order image. Return ONLY valid JSON with keys: poNumber (string), partNumber (string), quantity (number), dueDate (string YYYY-MM-DD), customer (string), notes (string). Use null for missing values.` }
      ]}],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from AI');
  return JSON.parse(text.replace(/```json|```/g, '').trim()) as SmartPasteData;
};

export const chatWithBot = async (history: {role: string, parts: {text: string}[]}[], message: string): Promise<string> => {
  const res = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You are SC Assistant, a helpful AI for SC Deburring manufacturing. Be concise and professional.' }] },
      contents: [...history.map(h => ({ role: h.role, parts: h.parts })), { role: 'user', parts: [{ text: message }] }]
    })
  });
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
};
```

---

**Step 2: In `App.tsx`**, find the `PriorityBadge` component and fix the icons:

Find:
```
const icons: Record<string, string> = { low: '↓', high: '↑', urgent: '🔴' };
```
Replace with:
```
const icons: Record<string, string> = { low: 'LOW', high: 'HIGH', urgent: 'URGENT' };
```

And find the `JobSelectionCard` priority badges:
```
{job.priority === 'high' && <span ...>↑ HIGH</span>}
```
Replace with:
```
{job.priority === 'high' && <span ...>HIGH</span>}
