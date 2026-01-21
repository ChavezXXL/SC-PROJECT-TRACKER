import { GoogleGenAI, Type, Modality } from "@google/genai";
import { SmartPasteData } from "../types";

const getClient = () => {
  // Guidelines: The API key must be obtained exclusively from the environment variable process.env.API_KEY.
  // Do not use localStorage or throw custom errors for missing keys, assume it is pre-configured.
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const parseJobDetails = async (rawText: string): Promise<SmartPasteData> => {
  const ai = getClient();
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Extract manufacturing job details from the following text. 
    Return ONLY a JSON object with keys: poNumber (string), partNumber (string), quantity (number), dueDate (string YYYY-MM-DD).
    If a value is missing, use null.
    Text: "${rawText}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          poNumber: { type: Type.STRING },
          partNumber: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          dueDate: { type: Type.STRING },
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  
  try {
    return JSON.parse(text) as SmartPasteData;
  } catch (e) {
    console.error("Failed to parse JSON", text);
    throw new Error("AI returned invalid JSON");
  }
};

export const chatWithBot = async (history: {role: string, parts: {text: string}[]}[], message: string) => {
  const ai = getClient();
  const chat = ai.chats.create({
    model: "gemini-3-pro-preview",
    history: history,
    config: {
      systemInstruction: "You are NexusBot, a helpful assistant for a manufacturing floor manager. You are concise, professional, and knowledgeable about industrial operations.",
    }
  });

  const result = await chat.sendMessage({ message });
  return result.text;
};

export const generateJobImage = async (prompt: string, size: '1K' | '2K' | '4K') => {
  const ai = getClient();
  
  // Model selection based on requirements
  const model = "gemini-3-pro-image-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: {
      parts: [{ text: prompt }]
    },
    config: {
      imageConfig: {
        imageSize: size,
        aspectRatio: "16:9"
      }
    }
  });

  // Extract image
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  throw new Error("No image generated");
};

export const generateSpeech = async (text: string): Promise<AudioBuffer> => {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("No audio generated");

  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  return await audioContext.decodeAudioData(bytes.buffer);
};